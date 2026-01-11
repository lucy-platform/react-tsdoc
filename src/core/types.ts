export enum ComponentFlags {
    None = 0,
    Export = 1 << 0,
    Hook = 1 << 1,
}

export interface IExportInfo {
    isDefault: boolean;
    isNamed: boolean;
}

export interface ITypeDefinition {
    comment: string;
}

export interface IFunctionParam {
    name: string;
    type: string;
    defaultValue?: string;
}

export interface IFunctionSignature extends ITypeDefinition {
    parameters: IFunctionParam[];
    return: string;
    generics?: string;
    code: string;
    typeReference?: string; // Original type annotation if present (e.g., "TestFunction")
}

export interface IUnion extends ITypeDefinition {
    items: string[];
    code: string;
}

export interface IInterfaceMember {
    name: string;
    type: string;
    comment: string;
    isOptional?: boolean;
    defaultValue?: string;
    exampleValue?: string;
}

export interface IInterfaceDeclaration extends ITypeDefinition {
    name: string;
    comment: string;
    members: IInterfaceMember[];
    code: string;
}

export interface IReactComponent {
    name: string;
    propType: string;
    stateType?: string;
    refType?: string;
    comment: string;
    type?: 'class' | 'functional' | 'forwardRef';
    exportInfo?: IExportInfo;
    wrappers?: string[];
    referencedComponent?: string;
}

export interface IReactHookParam {
    name: string;
    type: string;
    defaultValue?: string;
}

export interface IReactHook {
    name: string;
    type: string;
    parameters: IReactHookParam[];
    generics?: string;
    comment: string;
    typeReference?: string; // Original type annotation if present (e.g., "ToastHook")
}

export interface IEnumDeclaration extends ITypeDefinition {
    name: string;
    members: { name: string; value?: string }[];
    code: string;
}

export interface ITypeAlias extends ITypeDefinition {
    name: string;
    type: string;
    generics?: string;
    code: string;
}

export interface IDocInfo {
    interfaces: { [key: string]: IInterfaceDeclaration };
    components: { [key: string]: IReactComponent };
    hooks: { [key: string]: IReactHook };
    functions: { [key: string]: IFunctionSignature };
    unions: { [key: string]: IUnion };
    enums: { [key: string]: IEnumDeclaration };
    typeAliases: { [key: string]: ITypeAlias };
}

export interface IExample {
    summary: string;
}

export interface ITypeDocumentation {
    name: string;
    type: 'interface' | 'function' | 'union';
    summary: string;
    examples: IExample[];
    code: string;
    flags: ComponentFlags;
}

export interface IHookDocumentation {
    name: string;
    summary: string;
    examples: IExample[];
    flags: ComponentFlags;
}

export interface IComponentDocumentation {
    name: string;
    summary: string;
    examples: IExample[];
    props: IComponentPropDocumentation[];
    flags: ComponentFlags;
}

export interface IComponentPropDocumentation {
    name: string;
    type: string;
    summary: string;
    examples: IExample[];
}

export interface IDocObject {
    components: IComponentDocumentation[];
    hooks: IHookDocumentation[];
    types: ITypeDocumentation[];
}

export interface IExportModuleOptions {
    moduleName: string;
}