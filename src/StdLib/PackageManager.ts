import { LangFileSchema } from "../Generator/LangFileSchema";
import { extend } from "../Utils/Helpers";
import * as YAML from "js-yaml";

export class PackageId {
    type: "Interface"|"Implementation";
    name: string;
    version: string;
}

export interface PackageContent {
    id: PackageId;
    files: { [path: string]: string };
    fromCache: boolean;
}

export interface PackageBundle {
    packages: PackageContent[];
}

export interface PackageSource {
    getPackageBundle(ids: PackageId[], cachedOnly: boolean): Promise<PackageBundle>;
    getAllCached(): Promise<PackageBundle>;
}

export interface PackageNativeImpl {
    pkgName: string;
    pkgVendor: string;
    pkgVersion: string;
    fileName: string;
    code: string;
}

export interface InterfaceYaml {
    "file-version": number;
    vendor: string;
    name: string;
    version: number;
    "definition-file": string;
}

export class InterfacePackage {
    interfaceYaml: InterfaceYaml;
    definition: string;

    constructor(public content: PackageContent) {
        this.interfaceYaml = YAML.safeLoad(content.files["interface.yaml"]);
        this.definition = content.files[this.interfaceYaml["definition-file"]];
    }
}

export class ImplPkgImplementation {
    interface: { name: string; minver: number; maxver: number };
    language: string;
    "native-includes": string[];
    "native-includes-dir": string;
    implementation: LangFileSchema.LangFile;
}

export class ImplPackageYaml {
    "file-version": number;
    vendor: string;
    name: string;
    description: string;
    version: number;
    includes: string[];
    implements: ImplPkgImplementation[];
}

export class ImplementationPackage {
    implementationYaml: ImplPackageYaml;
    implementations: ImplPkgImplementation[] = [];

    constructor(public content: PackageContent) {
        this.implementationYaml = YAML.safeLoad(content.files["package.yaml"]);
        this.implementations = [...this.implementationYaml.implements||[]];
        for (const include of this.implementationYaml.includes||[]) {
            const included = <ImplPackageYaml> YAML.safeLoad(content.files[include]);
            this.implementations.push(...included.implements);
        }
    }
}

export class PackageManager {
    intefacesPkgs: InterfacePackage[] = [];
    implementationPkgs: ImplementationPackage[] = [];

    constructor(public source: PackageSource) { }

    async loadAllCached() {
        const allPackages = await this.source.getAllCached();

        for (const content of allPackages.packages.filter(x => x.id.type === "Interface"))
            this.intefacesPkgs.push(new InterfacePackage(content));

        for (const content of allPackages.packages.filter(x => x.id.type === "Implementation"))
            this.implementationPkgs.push(new ImplementationPackage(content));
    }

    getLangImpls(langName: string): ImplPkgImplementation[] {
        const allImpls = this.implementationPkgs.reduce((x,y) => [...x, ...y.implementations], []);
        return allImpls.filter(x => x.language === langName);
    }

    loadImplsIntoLangFile(lang: LangFileSchema.LangFile) {
        for (const impl of this.getLangImpls(lang.name))
            extend(lang, impl.implementation||{});
    }

    getInterfaceDefinitions() {
        return this.intefacesPkgs.map(x => x.definition).join("\n");
    }

    getLangNativeImpls(langName: string): PackageNativeImpl[] {
        let result = [];
        for (const pkg of this.implementationPkgs) {
            for (const impl of pkg.implementations.filter(x => x.language === langName)) {
                const fileNamePaths: { [name: string]: string } = {};
                for (const fileName of impl["native-includes"] || [])
                    fileNamePaths[fileName] = `native/${fileName}`;

                let incDir = impl["native-include-dir"];
                if (incDir) {
                    if (!incDir.endsWith("/")) incDir += "/";
                    const prefix = `native/${incDir}`;
                    for (const fn of Object.keys(pkg.content.files).filter(x => x.startsWith(prefix)).map(x => x.substr(prefix.length)))
                        fileNamePaths[fn] = `${prefix}${fn}`;
                }

                for (const [fileName, path] of Object.entries(fileNamePaths)) {
                    const code = pkg.content.files[path];
                    if (!code) throw new Error(`File '${fileName}' was not found for package '${pkg.implementationYaml.name}'`);
                    result.push({ 
                        pkgName: pkg.implementationYaml.name,
                        pkgVendor: pkg.implementationYaml.vendor,
                        pkgVersion: pkg.implementationYaml.version,
                        fileName,
                        code
                    });
                }

            }
        }
        return result;
    }
}
