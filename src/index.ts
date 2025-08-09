import * as tsdoc from '@microsoft/tsdoc';
import * as fs from 'fs';
import * as ts from 'typescript';
import chalk from 'chalk';
import { DocNode } from '@microsoft/tsdoc';
import clap from 'clap';
import mkdirp from 'mkdirp';

enum ComponentFlags {
    None = 0,
    Export = 1 << 0,
    Hook = 1 << 1,
}

interface IExportInfo {
    isDefault: boolean;
    isNamed: boolean;
}

function logCompilerMessage(message: string) {
    console.error(chalk.gray(`[TypeScript] ${message}`));
}
function logDebug(...objects: any[]) {
    console.log(chalk.gray(...objects));
}
function logInfo(...objects: any[]) {
    console.log(chalk.green(...objects));
}
function logWarning(...objects: any[]) {
    console.log(chalk.redBright(...objects));
}
function logError(...objects: any[]) {
    console.log(chalk.redBright(...objects));
}
function indentCode(code: string, chars: string) {
    let lines = code.split('\n').map(line => line.trimRight());
    return lines.map(line => chars + line).join('\n');
}
class MarkdownBuilder {
    private code = "";
    public addTitle(title: string, level: 1 | 2 | 3 | 4) {
        let headerChar = '#';
        let prefix = '';
        for (let i = 0; i < level; i++) {
            prefix += headerChar;
        }
        this.code += prefix + ' ' + title + '\n\n';
    }
    public addParagraph(p: string) {

        this.code += '\n\n' + p + '\n\n';
    }

    public addCode(code: string) {
        code = code.trim();
        if (code.startsWith('```')) {
            code = code.substring(3);
        }
        if (code.endsWith('```')) {
            code = code.substring(0, code.length - 3);
        }
        this.code += '\n\n```tsx\n' + code.trim() + '\n```\n\n'
    }
    public addTable(table: any[]) {
        const tableFormat = (s: string) => {
            return s.replace(/\s+/g, ' ').replace(/\|/g, '\\|');
        }
        if (table.length == 0) {
            this.code += '\n\n';
            return
        }
        let headers = Object.keys(table[0]);
        this.code += '|' + (headers.map(tableFormat)).join('|') + '|\n';
        this.code += '|' + (headers.map(h => '-')).join('|') + '|\n';
        for (let i in table) {
            let row = table[i];
            this.code += '|' + (headers.map(h => tableFormat(row[h]))).join('|') + '|\n';
        }

        this.code += '\n\n'

    }
    public toString() {
        return this.code;
    }
}
interface IExportModuleOptions {
    moduleName: string;
}

interface ITypeDefinition {
    comment: string;
}

interface IFunctionParam {
    name: string;
    type: string;
}
interface IFunctionSignature extends ITypeDefinition {
    parameters: IFunctionParam[];
    return: string;
    code: string;
}
interface IUnion extends ITypeDefinition {
    items: string[];
    code: string;
}
interface IInterfaceMember {
    name: string;
    type: string;
    comment: string;
}
interface IInterfaceDeclaration extends ITypeDefinition {
    name: string;
    comment: string;
    members: IInterfaceMember[];
    code: string;
}
interface IReactComponent {
    name: string;
    propType: string;
    stateType?: string;
    refType?: string;
    comment: string;
    type?: 'class' | 'functional' | 'forwardRef';
    exportInfo?: IExportInfo;
    wrappers?: string[];
    referencedComponent?: string; // Add this to track component references
}
interface IReactHookParam {
    name: string;
    type: string;
}
interface IReactHook {
    name: string;
    type: string;
    parameters: IReactHookParam[];
    comment: string;
}
interface IDocInfo {
    interfaces: { [key: string]: IInterfaceDeclaration };
    components: { [key: string]: IReactComponent };
    hooks: { [key: string]: IReactHook };
    functions: { [key: string]: IFunctionSignature };
    unions: { [key: string]: IUnion };
    enums: { [key: string]: IEnumDeclaration }; // Add enum support
    typeAliases: { [key: string]: ITypeAlias }; // Add type alias support
}

interface IEnumDeclaration extends ITypeDefinition {
    name: string;
    members: { name: string; value?: string }[];
    code: string;
}

interface ITypeAlias extends ITypeDefinition {
    name: string;
    type: string;
    code: string;
}

interface IExample {
    summary: string;

}
interface ITypeDocumentation {
    name: string;
    type: 'interface' | 'function' | 'union';
    summary: string;
    examples: IExample[];
    code: string;
    flags: ComponentFlags;

}

interface IHookDocumentation {
    name: string;
    summary: string;
    examples: IExample[];
    flags: ComponentFlags;
}
interface IComponentDocumentation {
    /**
     * The name of the component
     */
    name: string;

    /**
     * Summary
     */
    summary: string;

    /**
     * Examples
     */
    examples: IExample[];

    /**
     * Docs for individual properties
     */
    props: IComponentPropDocumentation[];

    /**
     * Any custom @-attribute flags set on the component
     */
    flags: ComponentFlags;

}
interface IDocObject {
    components: IComponentDocumentation[];
    hooks: IHookDocumentation[];
    types: ITypeDocumentation[];
}

/**
 * Individual property documentation
 */
interface IComponentPropDocumentation {
    name: string;
    type: string;
    summary: string;
    examples: IExample[];
}

// Helper function to check if node has @export annotation
function hasExportAnnotation(comment: string): boolean {
    try {
        const [, , flags] = parseTSDocComment(comment);
        return (flags & ComponentFlags.Export) === ComponentFlags.Export;
    } catch {
        return false;
    }
}

// Helper to get export info from node
function getExportInfo(node: ts.Node): IExportInfo {
    const sourceFile = node.getSourceFile();
    const exportInfo: IExportInfo = { isDefault: false, isNamed: false };

    // Check for export modifiers
    if (node.modifiers) {
        const hasExport = node.modifiers.some(mod => mod.kind === ts.SyntaxKind.ExportKeyword);
        const hasDefault = node.modifiers.some(mod => mod.kind === ts.SyntaxKind.DefaultKeyword);

        if (hasExport && hasDefault) {
            exportInfo.isDefault = true;
        } else if (hasExport) {
            exportInfo.isNamed = true;
        }
    }

    // Check for export statements
    sourceFile.forEachChild(child => {
        if (ts.isExportAssignment(child) && child.isExportEquals === false) {
            // export default X
            if (ts.isIdentifier(child.expression)) {
                const exportedName = child.expression.getText();
                const nodeName = (node as any).name?.getText();
                if (exportedName === nodeName) {
                    exportInfo.isDefault = true;
                }
            }
        }

        if (ts.isExportDeclaration(child) && child.exportClause && ts.isNamedExports(child.exportClause)) {
            // export { X }
            for (const element of child.exportClause.elements) {
                const exportedName = element.name.getText();
                const nodeName = (node as any).name?.getText();
                if (exportedName === nodeName) {
                    exportInfo.isNamed = true;
                }
            }
        }
    });

    return exportInfo;
}


function extractActualContentFromDocMess(node: tsdoc.DocNode): string {
    if (!node) {
        return "";
    }
    let result = "";
    if (node instanceof tsdoc.DocExcerpt) {
        result += node.content.toString();
    }
    for (const childNode of node.getChildNodes()) {
        result += extractActualContentFromDocMess(childNode);
    }
    return result;
}
function parseTSDocComment(comment: string): [string, IExample[], ComponentFlags] {
    let config = new tsdoc.TSDocConfiguration();

    config.addTagDefinition(
        new tsdoc.TSDocTagDefinition({
            tagName: '@export',
            syntaxKind: tsdoc.TSDocTagSyntaxKind.ModifierTag,
            allowMultiple: false
        })
    );

    config.addTagDefinition(
        new tsdoc.TSDocTagDefinition({
            tagName: '@hook',
            syntaxKind: tsdoc.TSDocTagSyntaxKind.ModifierTag,
            allowMultiple: false
        })
    );

    let parser = new tsdoc.TSDocParser(config);

    let ctx = parser.parseString(comment);
    let summary = extractActualContentFromDocMess(ctx.docComment.summarySection);
    let examples: IExample[] = [];
    let props: ComponentFlags = ComponentFlags.None;
    for (const block of ctx.docComment.customBlocks) {
        if (block.blockTag.tagName == '@example') {
            let example = { summary: extractActualContentFromDocMess(block.content) };
            examples.push(example);

        }
    }
    let flags: ComponentFlags = ComponentFlags.None;

    if (ctx.docComment.modifierTagSet.hasTagName('@export')) {
        flags = flags | ComponentFlags.Export;
    }

    if (ctx.docComment.modifierTagSet.hasTagName('@hook')) {
        flags = flags | ComponentFlags.Hook;
    }

    return [summary, examples, flags];
}
function generatePropDocs(inf: IInterfaceDeclaration) {
    let results: IComponentPropDocumentation[] = [];
    for (let i in inf.members) {
        let prop = inf.members[i];
        let propDoc: IComponentPropDocumentation = { examples: [], name: prop.name, summary: '', type: prop.type };
        [propDoc.summary, propDoc.examples] = parseTSDocComment(prop.comment);
        results.push(propDoc);
    }
    return results;
}
function generateHookTypeDefinition(hook: IReactHook) {
    return `export const ${hook.name}:${hook.type};`;
}
function generateComponentTypeDefinition(c: IReactComponent, interfaces: { [key: string]: IInterfaceDeclaration }) {
    let code = "";
    let type = c.type || 'functional'
    let inf = interfaces[c.propType];
    if (inf) {
        code += inf.comment + '\n';
        code += inf.code + '\n';
    }
    if (c.stateType) {
        let stateInf = interfaces[c.stateType];
        if (stateInf) {
            code += stateInf.comment + '\n';
            code += stateInf.code + '\n';
        }
    }
    if (c.refType) {
        let refInf = interfaces[c.refType];
        if (refInf) {
            code += refInf.comment + '\n';
            code += refInf.code + '\n';
        }
    }
    code += c.comment + '\n';

    switch (type) {
        case 'functional':
            code += `export const ${c.name} : React.FunctionComponent<${c.propType}>;\n`
            break
        case 'class':
            code += `export class ${c.name} extends React.Component<${c.propType}, ${c.stateType || 'any'}> {}\n`
            break
        case 'forwardRef':
            code += `export const ${c.name}:React.ForwardRefExoticComponent<${c.propType} & React.RefAttributes<${c.refType || 'any'}>>;\n`
            break
    }

    return code;
}
function fillRelatedTypes(t: string, types: any, docInfo: IDocInfo) {
    if (docInfo.interfaces[t]) {
        types[t] = 1;
        let inf = docInfo.interfaces[t];
        for (let m of inf.members) {
            fillRelatedTypes(m.comment, types, docInfo);
        }
        return;
    }
    if (docInfo.unions[t]) {
        types[t] = 1;
        return;
    }
    if (docInfo.functions[t]) {
        let f = docInfo.functions[t];
        types[t] = 1;
        fillRelatedTypes(f.return, types, docInfo);
        for (let p of f.parameters) {
            let pt = p.type;
            fillRelatedTypes(pt, types, docInfo);
        }
    }

}
function generateDocObject(docInfo: IDocInfo): IDocObject {
    let components: IComponentDocumentation[] = [];
    //let typesToExport:any = {};
    for (let cn in docInfo.components) {
        let componentDoc: IComponentDocumentation = { examples: [], name: cn, props: [], summary: '', flags: ComponentFlags.None };
        let componentInfo = docInfo.components[cn];
        [componentDoc.summary, componentDoc.examples, componentDoc.flags] = parseTSDocComment(componentInfo.comment);

        let propType = docInfo.interfaces[componentInfo.propType];
        if (!!propType) {
            componentDoc.props = generatePropDocs(propType)
        }
        //typesToExport[componentInfo.propType] = 1;

        components.push(componentDoc);

    }
    let hooks: IHookDocumentation[] = [];
    for (let hi in docInfo.hooks) {
        let hook = docInfo.hooks[hi];
        let hookDoc: IHookDocumentation = { name: hook.name, flags: ComponentFlags.None, summary: '', examples: [] };
        [hookDoc.summary, hookDoc.examples, hookDoc.flags] = parseTSDocComment(hook.comment);
        let propType = docInfo.functions[hook.type];
        // if (!!propType) {
        //     typesToExport[hook.type] = 1;
        // }
        hooks.push(hookDoc);
    }
    //console.log(typesToExport);
    // for(let k of Object.keys(typesToExport)) {
    //     fillRelatedTypes(k,typesToExport,docInfo);
    // }
    let types: ITypeDocumentation[] = [];
    for (let k of Object.keys(docInfo.interfaces)) {
        let inf = docInfo.interfaces[k];
        let typeDoc: ITypeDocumentation = { examples: [], name: inf.name, summary: '', type: 'interface', code: '', flags: ComponentFlags.None };
        typeDoc.code = inf.code;
        [typeDoc.summary, typeDoc.examples, typeDoc.flags] = parseTSDocComment(inf.comment);
        types.push(typeDoc);
    }
    for (let k of Object.keys(docInfo.functions)) {
        let inf = docInfo.functions[k];
        let typeDoc: ITypeDocumentation = { examples: [], name: k, summary: '', type: 'function', code: '', flags: ComponentFlags.None };
        typeDoc.code = inf.code;
        [typeDoc.summary, typeDoc.examples, typeDoc.flags] = parseTSDocComment(inf.comment);
        types.push(typeDoc);
    }
    for (let k of Object.keys(docInfo.unions)) {
        let inf = docInfo.unions[k];
        let typeDoc: ITypeDocumentation = { examples: [], name: k, summary: '', type: 'union', code: '', flags: ComponentFlags.None };
        typeDoc.code = inf.code;
        [typeDoc.summary, typeDoc.examples, typeDoc.flags] = parseTSDocComment(inf.comment);
        types.push(typeDoc);
    }


    return { components, hooks, types };
}

function extractComment(node: ts.Node) {
    let fullText = node.getSourceFile().getFullText();
    let comments = ts.getLeadingCommentRanges(fullText, node.pos);
    if (!comments) return '';
    return comments!.map(c => fullText.slice(c.pos, c.end)).join('\n');
}
function getCode(node: ts.Node) {
    return node.getSourceFile().getFullText().substring(node.getStart(), node.getEnd());
}
function parseFunctionSignature(node: ts.Node, docInfo: IDocInfo) {

}
function parseInterfaceDeclaration(node: ts.Node, docInfo: IDocInfo) {

    let name = (node as any).name.getText();
    let members = (node as any).members;
    if (members.length == 1 && members[0].kind == ts.SyntaxKind.CallSignature) {
        return parseFunctionSignature(members[0], docInfo);
    }

    let docs = extractComment(node);
    let inf: IInterfaceDeclaration = { comment: docs, members: [], name: name, code: getCode(node) };
    for (let i = 0; i < members.length; i++) {
        let member = members[i];
        let name = member.name.getText();
        let type = member.type.getText();
        let mdoc = extractComment(member);
        inf.members.push({ comment: mdoc, name: name, type: type });
    }
    docInfo.interfaces[name] = inf;

}

function parseVariableDeclaration(node: ts.Node, docInfo: IDocInfo, checker: ts.TypeChecker) {
    if (!ts.isVariableDeclaration(node)) return;

    const decl = node as ts.VariableDeclaration;
    const name = decl.name?.getText();
    if (!name) return;

    const parentForComments = (decl.parent && decl.parent.parent) ? decl.parent.parent : node.parent;
    const comment = extractComment(parentForComments || node) || '';
    const exportInfo = getExportInfo(parentForComments || node);

    // Only proceed if has @export annotation or is exported
    if (!hasExportAnnotation(comment) && !exportInfo.isDefault && !exportInfo.isNamed) {
        return;
    }

    const init = decl.initializer;
    const declaredType = (decl as any).type as ts.TypeNode | undefined;

    // Handle explicit type annotations first
    if (declaredType && !init) {
        const typeText = declaredType.getText();
        const isExplicitComponent = /\b(React\.)?(FunctionComponent|FC|ForwardRefExoticComponent|Component)\b/.test(typeText);

        if (isExplicitComponent) {
            const propMatch = typeText.match(/<\s*([^>,]+)/);
            const refMatch = typeText.match(/RefAttributes\s*<\s*([^>]+)\s*>/);

            docInfo.components[name] = {
                comment,
                propType: propMatch ? propMatch[1].trim() : 'any',
                refType: refMatch ? refMatch[1].trim() : undefined,
                name,
                type: /ForwardRefExoticComponent/.test(typeText) ? 'forwardRef' : 'functional',
                exportInfo
            };
            return;
        }
    }

    if (!init) return;

    // Handle hooks (name starts with 'use')
    if (name.startsWith('use')) {
        const parameters: IReactHookParam[] = [];
        let hookReturnType = 'void';

        if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
            if (init.parameters) {
                for (const param of init.parameters) {
                    const pname = param.name?.getText() || 'arg';
                    const ptype = param.type ? param.type.getText() : 'any';
                    parameters.push({ name: pname, type: ptype });
                }
            }

            // Get return type from function
            if (init.type) {
                hookReturnType = init.type.getText();
            } else if (declaredType) {
                const typeText = declaredType.getText();
                // Extract return type from function signature
                const match = typeText.match(/\(\s*[^)]*\)\s*=>\s*(.+)$/);
                hookReturnType = match ? match[1].trim() : 'void';
            }
        }

        docInfo.hooks[name] = {
            name,
            type: hookReturnType,
            parameters,
            comment
        };
        return;
    }

    // Analyze component patterns
    const componentInfo = analyzeComponentPattern(init, name, comment, exportInfo, checker, docInfo);
    if (componentInfo) {
        docInfo.components[name] = componentInfo;
        return;
    }

    // Handle regular functions with proper type extraction
    if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
        const params: IFunctionParam[] = [];
        if (init.parameters) {
            for (const param of init.parameters) {
                const pname = param.name?.getText() || 'arg';
                const ptype = param.type ? param.type.getText() : 'any';
                params.push({ name: pname, type: ptype });
            }
        }

        let returnType = 'void';

        // Priority: explicit type annotation > function return type > inferred
        if (declaredType) {
            const typeText = declaredType.getText();
            // Check if it's a type alias reference
            if (docInfo.functions[typeText] || docInfo.typeAliases?.[typeText]) {
                returnType = typeText; // Use the type alias name directly
            } else {
                // Extract return type from function type
                const match = typeText.match(/^\([^)]*\)\s*=>\s*(.+)$/) || typeText.match(/=>\s*(.+)$/);
                returnType = match ? match[1].trim() : typeText;
            }
        } else if (init.type) {
            returnType = init.type.getText();
        }

        docInfo.functions[name] = {
            parameters: params,
            return: returnType,
            comment,
            code: getCode(decl)
        };
    }
}

function unwrapCallWrappers(expr: ts.Expression): { inner: ts.Expression, wrappers: string[] } {
    const wrappers: string[] = [];
    let current: ts.Expression = expr;

    while (ts.isCallExpression(current) && current.expression) {
        const callee = current.expression.getText();
        wrappers.push(callee);

        if (current.arguments && current.arguments.length > 0) {
            const firstArg = current.arguments[0];
            if (ts.isFunctionExpression(firstArg) || ts.isArrowFunction(firstArg) ||
                ts.isCallExpression(firstArg) || ts.isIdentifier(firstArg) ||
                ts.isClassExpression(firstArg)) {
                current = firstArg;
                continue;
            }
        }
        break;
    }
    return { inner: current, wrappers };
}
function analyzeComponentPattern(init: ts.Expression, name: string, comment: string, exportInfo: IExportInfo, checker: ts.TypeChecker, docInfo: IDocInfo): IReactComponent | null {
    const { inner, wrappers } = unwrapCallWrappers(init);

    const isWrappedForwardRef = wrappers.some(w => /\b(React\.)?forwardRef$/.test(w));
    const isWrappedMemo = wrappers.some(w => /\b(React\.)?memo$/.test(w));

    if (isWrappedForwardRef || isWrappedMemo) {
        let propType: string | undefined;
        let refType: string | undefined;
        let componentType: 'functional' | 'forwardRef' = 'functional';

        if ((ts.isArrowFunction(inner) || ts.isFunctionExpression(inner)) && inner.parameters && inner.parameters.length > 0) {
            const firstParam = inner.parameters[0];
            propType = firstParam.type ? firstParam.type.getText() : 'any';

            if (isWrappedForwardRef && inner.parameters.length > 1) {
                const secondParam = inner.parameters[1];
                refType = secondParam.type ? secondParam.type.getText() : undefined;
                componentType = 'forwardRef';
            }
        }

        return {
            comment,
            propType: propType || 'any',
            refType,
            name,
            type: componentType,
            exportInfo,
            wrappers: wrappers.filter(w => /\b(React\.)?(memo|forwardRef)$/.test(w))
        };
    }

    // Handle identifier references to other components
    if (ts.isIdentifier(inner)) {
        const referencedName = inner.getText();

        // Check if it references an existing component in docInfo
        if (docInfo.components[referencedName]) {
            const referencedComponent = docInfo.components[referencedName];
            return {
                comment,
                propType: referencedComponent.propType,
                refType: referencedComponent.refType,
                stateType: referencedComponent.stateType,
                name,
                type: referencedComponent.type,
                exportInfo,
                wrappers: wrappers.filter(w => /\b(React\.)?(memo|forwardRef)$/.test(w)),
                referencedComponent: referencedName // Track the reference
            };
        }
    }

    // Handle class expressions
    if (ts.isClassExpression(inner)) {
        const heritage = inner.heritageClauses;
        if (heritage && heritage.length > 0) {
            const first = heritage[0].types && heritage[0].types[0];
            if (first) {
                const baseText = first.expression ? first.expression.getText() : '';
                if (/\b(React\.)?Component\b/.test(baseText) || /\b(React\.)?PureComponent\b/.test(baseText)) {
                    let propType = 'any';
                    if (first.typeArguments && first.typeArguments.length >= 1) {
                        propType = first.typeArguments[0].getText();
                    }

                    return {
                        comment,
                        propType,
                        name,
                        type: 'class',
                        exportInfo
                    };
                }
            }
        }
    }

    return null;
}

function parseClassDeclaration(node: ts.Node, docInfo: IDocInfo, checker?: ts.TypeChecker) {
    if (!ts.isClassDeclaration(node)) return;

    const name = node.name?.getText();
    if (!name) return;

    const comment = extractComment(node);
    const exportInfo = getExportInfo(node);

    // Only proceed if has @export annotation or is exported
    if (!hasExportAnnotation(comment) && !exportInfo.isDefault && !exportInfo.isNamed) {
        return;
    }

    const heritage = node.heritageClauses && node.heritageClauses.length > 0 ? node.heritageClauses[0] : undefined;
    if (!heritage || !heritage.types || heritage.types.length === 0) {
        return;
    }

    const first = heritage.types[0];
    const baseText = first.expression ? first.expression.getText() : '';
    const isReactComponentBase = /\b(React\.)?Component\b/.test(baseText) || /\b(React\.)?PureComponent\b/.test(baseText);

    if (isReactComponentBase) {
        let propType: string | undefined;
        let stateType: string | undefined;

        if (first.typeArguments && first.typeArguments.length >= 1) {
            propType = first.typeArguments[0].getText();
            if (first.typeArguments.length >= 2) {
                stateType = first.typeArguments[1].getText();
            }
        }

        docInfo.components[name] = {
            comment,
            propType: propType || 'any',
            stateType,
            name,
            type: 'class',
            exportInfo
        };
    }
}

function parseFunctionDeclaration(node: ts.Node, docInfo: IDocInfo, checker?: ts.TypeChecker) {
    if (!ts.isFunctionDeclaration(node)) return;
    const name = node.name?.getText();
    if (!name) return;

    const comment = extractComment(node) || '';
    const exportInfo = getExportInfo(node);

    // Only proceed if has @export annotation or is exported
    if (!hasExportAnnotation(comment) && !exportInfo.isDefault && !exportInfo.isNamed) {
        return;
    }

    // Handle hooks
    if (name.startsWith('use')) {
        const parameters: IReactHookParam[] = [];
        if (node.parameters) {
            for (const p of node.parameters) {
                const pname = p.name?.getText?.() ?? 'arg';
                let ptype = p.type ? p.type.getText() : 'any';
                parameters.push({ name: pname, type: ptype });
            }
        }
        docInfo.hooks[name] = { name, type: 'function', parameters, comment };
    }

    // Always capture function signature
    const params: IFunctionParam[] = [];
    if (node.parameters) {
        for (const p of node.parameters) {
            const pname = p.name?.getText?.() ?? 'arg';
            let ptype = p.type ? p.type.getText() : 'any';
            params.push({ name: pname, type: ptype });
        }
    }

    let returnType = 'void';
    if (node.type) {
        returnType = node.type.getText();
    }

    docInfo.functions[name] = {
        parameters: params,
        return: returnType,
        comment,
        code: getCode(node)
    };
}
function parseEnumDeclaration(node: ts.Node, docInfo: IDocInfo) {
    if (!ts.isEnumDeclaration(node)) return;

    const name = node.name.getText();
    const comment = extractComment(node);
    const code = getCode(node);

    const members: { name: string; value?: string }[] = [];
    for (const member of node.members) {
        const memberName = member.name?.getText() || '';
        const value = member.initializer?.getText();
        members.push({ name: memberName, value });
    }

    docInfo.enums[name] = { comment, members, name, code };
}

function parseTypeAlias(node: ts.Node, docInfo: IDocInfo) {
    if (!ts.isTypeAliasDeclaration(node)) return;

    const name = node.name.getText();
    const type = node.type;
    const comment = extractComment(node);
    const code = getCode(node);

    if (type.kind === ts.SyntaxKind.FunctionType) {
        // Function type alias
        const parameters: IFunctionParam[] = [];
        const funcType = type as ts.FunctionTypeNode;

        if (funcType.parameters) {
            for (const param of funcType.parameters) {
                const pname = param.name?.getText() || 'arg';
                const ptype = param.type ? param.type.getText() : 'any';
                parameters.push({ name: pname, type: ptype });
            }
        }

        const returnType = funcType.type ? funcType.type.getText() : 'void';
        docInfo.functions[name] = {
            parameters,
            return: returnType,
            comment,
            code
        };
        return;
    }

    if (type.kind === ts.SyntaxKind.UnionType) {
        // Union type alias
        const unionType = type as ts.UnionTypeNode;
        const items: string[] = [];

        for (const unionMember of unionType.types) {
            items.push(unionMember.getText());
        }

        docInfo.unions[name] = { items, comment, code };
        return;
    }

    // Regular type alias
    docInfo.typeAliases[name] = {
        name,
        type: type.getText(),
        comment,
        code
    };
}
function collectAllDependentTypes(docInfo: IDocInfo): Set<string> {
    const collectedTypes = new Set<string>();
    const visited = new Set<string>();
    
    function extractTypeNames(typeStr: string): string[] {
        if (!typeStr) return [];
        
        const typePattern = /\b([A-Z][a-zA-Z0-9]*)\b/g;
        const matches = [];
        let match;
        
        while ((match = typePattern.exec(typeStr)) !== null) {
            const typeName = match[1];
            if (!['React', 'Promise', 'Array', 'Map', 'Set', 'Date', 'Error', 'String', 'Number', 'Boolean'].includes(typeName)) {
                matches.push(typeName);
            }
        }
        
        return matches;
    }
    
    function collectDependencies(typeName: string) {
        if (visited.has(typeName)) return;
        visited.add(typeName);
        
        // Always collect the type if it exists, regardless of @export annotation
        if (docInfo.interfaces?.[typeName]) {
            collectedTypes.add(typeName);
            const intf = docInfo.interfaces[typeName];
            
            const extendsMatch = intf.code.match(/extends\s+([^{]+)/);
            if (extendsMatch) {
                const extendedTypes = extractTypeNames(extendsMatch[1]);
                extendedTypes.forEach(t => collectDependencies(t));
            }
            
            intf.members.forEach(member => {
                const memberTypes = extractTypeNames(member.type);
                memberTypes.forEach(t => collectDependencies(t));
            });
        }
        
        if (docInfo.unions?.[typeName]) {
            collectedTypes.add(typeName);
            const union = docInfo.unions[typeName];
            union.items.forEach(item => {
                const itemTypes = extractTypeNames(item);
                itemTypes.forEach(t => collectDependencies(t));
            });
        }
        
        if (docInfo.enums?.[typeName]) {
            collectedTypes.add(typeName);
        }
        
        if (docInfo.typeAliases?.[typeName]) {
            collectedTypes.add(typeName);
            const alias = docInfo.typeAliases[typeName];
            const aliasTypes = extractTypeNames(alias.type);
            aliasTypes.forEach(t => collectDependencies(t));
        }
        
        if (docInfo.functions[typeName]) {
            collectedTypes.add(typeName);
            const func = docInfo.functions[typeName];
            const returnTypes = extractTypeNames(func.return);
            returnTypes.forEach(t => collectDependencies(t));
            
            func.parameters.forEach(param => {
                const paramTypes = extractTypeNames(param.type);
                paramTypes.forEach(t => collectDependencies(t));
            });
        }
    }
    
    // Collect from exported components
    Object.values(docInfo.components).forEach(comp => {
        if (hasExportAnnotation(comp.comment) || comp.exportInfo?.isDefault || comp.exportInfo?.isNamed) {
            const propTypes = extractTypeNames(comp.propType);
            propTypes.forEach(t => collectDependencies(t));
            
            if (comp.stateType) {
                const stateTypes = extractTypeNames(comp.stateType);
                stateTypes.forEach(t => collectDependencies(t));
            }
            
            if (comp.refType) {
                const refTypes = extractTypeNames(comp.refType);
                refTypes.forEach(t => collectDependencies(t));
            }
        }
    });
    
    // Collect from exported functions
    Object.values(docInfo.functions).forEach(func => {
        if (hasExportAnnotation(func.comment)) {
            const returnTypes = extractTypeNames(func.return);
            returnTypes.forEach(t => collectDependencies(t));
            
            func.parameters.forEach(param => {
                const paramTypes = extractTypeNames(param.type);
                paramTypes.forEach(t => collectDependencies(t));
            });
        }
    });
    
    // Collect from exported hooks
    Object.values(docInfo.hooks).forEach(hook => {
        if (hasExportAnnotation(hook.comment)) {
            // Collect from hook return type
            const returnTypes = extractTypeNames(hook.type);
            returnTypes.forEach(t => collectDependencies(t));
            
            hook.parameters.forEach(param => {
                const paramTypes = extractTypeNames(param.type);
                paramTypes.forEach(t => collectDependencies(t));
            });
        }
    });
    
    return collectedTypes;
}
function walkTree(node: ts.Node, docInfo: IDocInfo, checker: ts.TypeChecker) {
    switch (node.kind) {
        case ts.SyntaxKind.TypeAliasDeclaration:
            parseTypeAlias(node, docInfo);
            break;
        case ts.SyntaxKind.InterfaceDeclaration:
            parseInterfaceDeclaration(node, docInfo);
            break;
        case ts.SyntaxKind.EnumDeclaration:
            parseEnumDeclaration(node, docInfo);
            break;
        case ts.SyntaxKind.VariableDeclaration:
            parseVariableDeclaration(node, docInfo, checker);
            break;
        case ts.SyntaxKind.ClassDeclaration:
            parseClassDeclaration(node, docInfo, checker);
            break;
        case ts.SyntaxKind.FunctionDeclaration:
            parseFunctionDeclaration(node, docInfo, checker);
            break;
    }

    node.forEachChild((child: any) => walkTree(child, docInfo, checker));
}

function validateProgram(program: ts.Program) {
    const compilerDiagnostics: ReadonlyArray<ts.Diagnostic> = program.getSemanticDiagnostics();
    if (compilerDiagnostics.length > 0) {
        for (const diagnostic of compilerDiagnostics) {

            const message: string = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
            if (diagnostic.file) {
                const location: ts.LineAndCharacter = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start!);
                const formattedMessage: string = `${diagnostic.file.fileName}(${location.line + 1},${location.character + 1}):`
                    + `${message}`;
                logCompilerMessage(formattedMessage);
            } else {
                logCompilerMessage(message);
            }
        }
    } else {
        logCompilerMessage('No compiler errors or warnings.');
    }
}

function getSources(program: ts.Program) {
    return program.getSourceFiles().filter(f => {
        return f.fileName.indexOf('node_modules') < 0
    }).map(f => f.fileName);
}

function collectReferencedTypes(docInfo: IDocInfo): Set<string> {
    const referencedTypes = new Set<string>();

    // Helper to extract type names from type strings
    function extractTypeNames(typeStr: string) {
        // Remove common TypeScript syntax and extract identifiers
        const cleaned = typeStr
            .replace(/[<>()[\]{}|&,;]/g, ' ')
            .replace(/\b(string|number|boolean|void|any|unknown|never|null|undefined|Promise|Array)\b/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        const words = cleaned.split(' ').filter(w => w.length > 0 && /^[A-Z]/.test(w));
        words.forEach(word => referencedTypes.add(word));
    }

    const isExported = (comment: string) => {
        try {
            const [, , flags] = parseTSDocComment(comment);
            return (flags & ComponentFlags.Export) === ComponentFlags.Export;
        } catch {
            return false;
        }
    };

    // Collect types from exported components
    Object.values(docInfo.components).forEach(comp => {
        if (isExported(comp.comment)) {
            extractTypeNames(comp.propType);
            if (comp.stateType) extractTypeNames(comp.stateType);
            if (comp.refType) extractTypeNames(comp.refType);
        }
    });

    // Collect types from exported functions
    Object.values(docInfo.functions).forEach(func => {
        if (isExported(func.comment)) {
            extractTypeNames(func.return);
            func.parameters.forEach(param => extractTypeNames(param.type));
        }
    });

    // Collect types from exported hooks
    Object.values(docInfo.hooks).forEach(hook => {
        if (isExported(hook.comment)) {
            hook.parameters.forEach(param => extractTypeNames(param.type));
        }
    });

    return referencedTypes;
}

function generateComplexComponentType(comp: IReactComponent, docInfo: IDocInfo): string {
    let baseType = '';

    // If this component references another component, use the referenced component's details
    if (comp.referencedComponent && docInfo.components[comp.referencedComponent]) {
        const referencedComp = docInfo.components[comp.referencedComponent];

        if (referencedComp.type === 'class') {
            baseType = `React.Component<${referencedComp.propType}, ${referencedComp.stateType || 'any'}>`;
        } else if (referencedComp.type === 'forwardRef') {
            baseType = `React.ForwardRefExoticComponent<React.RefAttributes<${referencedComp.refType || 'any'}> & ${referencedComp.propType}>`;
        } else {
            baseType = `React.FunctionComponent<${referencedComp.propType}>`;
        }
    } else {
        // Generate type for the component itself
        if (comp.type === 'class') {
            baseType = `React.Component<${comp.propType}, ${comp.stateType || 'any'}>`;
        } else if (comp.type === 'forwardRef') {
            baseType = `React.ForwardRefExoticComponent<React.RefAttributes<${comp.refType || 'any'}> & ${comp.propType}>`;
        } else {
            baseType = `React.FunctionComponent<${comp.propType}>`;
        }
    }

    // Wrap with memo if needed
    if (comp.wrappers && comp.wrappers.some(w => /\bmemo$/.test(w))) {
        baseType = `React.MemoExoticComponent<${baseType}>`;
    }

    return baseType;
}

function generateExportModule(docs: IDocObject, docInfo: IDocInfo, options: IExportModuleOptions) {
    let code = '';
    const openedModule = !!(options && options.moduleName);
    if (openedModule) {
        code += `declare module "${options.moduleName}" {\n`;
    }

    const emitted = new Set<string>();
    const dependentTypes = collectAllDependentTypes(docInfo);

    // Emit dependent types first
    for (const typeName of dependentTypes) {
        if (emitted.has(typeName)) continue;

        if (docInfo.interfaces?.[typeName]) {
            const intf = docInfo.interfaces[typeName];
            const toEmit = '\n' + intf.comment + '\n' + intf.code + '\n';
            code += indentCode(toEmit, '    ');
            emitted.add(typeName);
        } else if (docInfo.unions?.[typeName]) {
            const union = docInfo.unions[typeName];
            const toEmit = '\n' + union.comment + '\n' + union.code + '\n';
            code += indentCode(toEmit, '    ');
            emitted.add(typeName);
        } else if (docInfo.enums?.[typeName]) {
            const enumObj = docInfo.enums[typeName];
            const toEmit = '\n' + enumObj.comment + '\n' + enumObj.code + '\n';
            code += indentCode(toEmit, '    ');
            emitted.add(typeName);
        } else if (docInfo.typeAliases?.[typeName]) {
            const alias = docInfo.typeAliases[typeName];
            const toEmit = '\n' + alias.comment + '\n' + alias.code + '\n';
            code += indentCode(toEmit, '    ');
            emitted.add(typeName);
        }
    }

    // Emit exported components with proper complex types
    Object.values(docInfo.components).forEach(comp => {
        if (emitted.has(comp.name)) return;
        
        const shouldExport = hasExportAnnotation(comp.comment) || comp.exportInfo?.isDefault || comp.exportInfo?.isNamed;
        if (shouldExport) {
            const complexType = generateComplexComponentType(comp, docInfo);
            const commentBlock = comp.comment ? '\n' + comp.comment + '\n' : '\n';
            const declaration = `export const ${comp.name}: ${complexType};\n`;
            code += indentCode(commentBlock + declaration, '    ');
            emitted.add(comp.name);
        }
    });

    // Emit exported functions (excluding type aliases that are functions)
    Object.keys(docInfo.functions).forEach(fname => {
        if (emitted.has(fname)) return;
        const f = docInfo.functions[fname];
        
        // Skip if this is actually a type alias
        if (docInfo.typeAliases?.[fname]) return;
        
        if (hasExportAnnotation(f.comment)) {
            const paramsTxt = f.parameters.map(p => `${p.name}: ${p.type}`).join(', ');
            const commentBlock = f.comment ? '\n' + f.comment + '\n' : '\n';
            const declaration = `export function ${fname}(${paramsTxt}): ${f.return};\n`;
            code += indentCode(commentBlock + declaration, '    ');
            emitted.add(fname);
        }
    });

    // Emit exported hooks
    Object.values(docInfo.hooks).forEach(hook => {
        if (emitted.has(hook.name)) return;
        
        if (hasExportAnnotation(hook.comment)) {
            const paramsTxt = hook.parameters.map(p => `${p.name}: ${p.type}`).join(', ');
            const commentBlock = hook.comment ? '\n' + hook.comment + '\n' : '\n';
            const declaration = `export function ${hook.name}(${paramsTxt}): ${hook.type};\n`;
            code += indentCode(commentBlock + declaration, '    ');
            emitted.add(hook.name);
        }
    });

    if (openedModule) {
        code += `\n}\n`;
    }

    return code;
}

function load(root: string): [IDocInfo, IDocObject] {
    const options: ts.CompilerOptions = {
        jsx: ts.JsxEmit.React,
    };

    logDebug('Loading', root);
    const program = ts.createProgram([root], options);
    logDebug('Compiled');

    // create a type checker we will pass down for robust resolution
    const checker = program.getTypeChecker();

    validateProgram(program);
    logDebug('Validated');

    const sources = getSources(program);
    const docInfo: IDocInfo = { interfaces: {}, components: {}, hooks: {}, functions: {}, unions: {}, enums: {}, typeAliases: {} };

    for (let i = 0; i < sources.length; i++) {
        const source = sources[i];
        logDebug('Loading', source);
        const sourceNode = program.getSourceFile(source);
        if (!sourceNode) continue;

        try {
            walkTree(sourceNode, docInfo, checker);
        } catch (error) {
            logError(`Error in ${source}: ${error}`);
        }
    }

    const docs = generateDocObject(docInfo);
    return [docInfo, docs];
}

function generateHookDoc(cdoc: IHookDocumentation, docs: IDocObject) {
    let md = new MarkdownBuilder();
    md.addTitle(cdoc.name, 1)
    md.addParagraph(cdoc.summary);
    md.addTitle('Installation', 2);
    md.addCode(`import {${cdoc.name}} from 'uxp/components';`);
    if (cdoc.examples.length > 0) {
        md.addTitle('Examples', 2);
        for (let i in cdoc.examples) {
            md.addCode(cdoc.examples[i].summary)
        }
    }

    return md.toString();
}

function generateTypeDoc(cdoc: ITypeDocumentation, docs: IDocObject) {
    let md = new MarkdownBuilder();
    md.addTitle(cdoc.name, 1)
    md.addParagraph(cdoc.summary);
    md.addCode(cdoc.code);
    md.addTitle('Usage', 2);
    md.addCode(`import {${cdoc.name}} from 'uxp/components';`);
    if (cdoc.examples.length > 0) {
        md.addTitle('Examples', 2);
        for (let i in cdoc.examples) {
            md.addCode(cdoc.examples[i].summary)
        }
    }


    return md.toString();
}
function linkedType(t: string, docs: IDocObject) {
    if (docs.types.find(x => x.name.toUpperCase() == t.toUpperCase())) {
        return `[${t}](../types/${t}.md)`;
    }
    return t;
}
function generateComponentDoc(cdoc: IComponentDocumentation, docs: IDocObject) {
    let md = new MarkdownBuilder();
    md.addTitle(cdoc.name, 1)
    md.addParagraph(cdoc.summary);
    md.addTitle('Installation', 2);
    md.addCode(`import {${cdoc.name}} from 'uxp/components';`);
    if (cdoc.examples.length > 0) {
        md.addTitle('Examples', 2);
        for (let i in cdoc.examples) {
            md.addCode(cdoc.examples[i].summary)
        }
    }
    if (cdoc.props.length > 0) {

        md.addTitle('Properties', 2);
        md.addTable(cdoc.props.map(p => ({ Name: p.name, Type: linkedType(p.type, docs), Description: p.summary })));
        for (let i in cdoc.props) {
            let prop = cdoc.props[i];
            md.addTitle(prop.name, 3);
            md.addParagraph('---');
            md.addParagraph(prop.summary);
            md.addTable([{ 'type': linkedType(prop.type, docs) }]);

            for (let j in prop.examples) {
                md.addCode(prop.examples[j].summary);
            }
        }

    }
    return md.toString();
}
function generateDocs(root: string, outputPath: string) {
    let [docInfo, docs] = load(root);
    let components = docs.components;
    if (outputPath.endsWith('/')) outputPath = outputPath.substring(0, outputPath.length - 1);

    mkdirp.sync(outputPath + '/components/');
    mkdirp.sync(outputPath + '/types/');
    mkdirp.sync(outputPath + '/hooks/');

    for (let i in components) {
        let component = components[i];
        if (ComponentFlags.Export === (component.flags & ComponentFlags.Export)) {
            let md = generateComponentDoc(component, docs);
            let path = outputPath + '/components/' + component.name + '.md';

            console.log(chalk.gray('Writing component', component.name, 'to', path));
            fs.writeFileSync(path, md.toString());
        }
    }
    for (let i in docs.types) {
        let type = docs.types[i];
        if (ComponentFlags.Export === (type.flags & ComponentFlags.Export)) {
            let md = generateTypeDoc(type, docs);
            let path = outputPath + '/types/' + type.name + '.md';
            console.log(chalk.gray('Writing type', type.name, 'to', path));
            fs.writeFileSync(path, md.toString());
        }
    }

    for (let i in docs.hooks) {
        let hook = docs.hooks[i];
        if (ComponentFlags.Export === (hook.flags & ComponentFlags.Export)) {
            let md = generateHookDoc(hook, docs);
            let path = outputPath + '/hooks/' + hook.name + '.md';
            console.log(chalk.gray('Writing hook', hook.name, 'to', path));
            fs.writeFileSync(path, md.toString());
        }
    }
}
function generateTypeDefinition(root: string, outputPath: string, moduleName: string) {


    let [docInfo, docs] = load(root);
    let moduleCode = generateExportModule(docs, docInfo, { moduleName: moduleName || 'module' });
    fs.writeFileSync(outputPath, moduleCode);
}

export function main() {
    try {
        let cmd = clap
            .command('react-tsdoc')
            .description('Generate docs for React components')
            .version('0.0.1')
            ;
        cmd.command('types [input.ts] [output.t.ds]')
            .option('--module-name <name>')


            .action((actionArgs: { args: string[], options: any }) => {
                let args = actionArgs.args || [];
                let options = actionArgs.options || {};

                generateTypeDefinition(
                    args[0],
                    args[1],
                    options.moduleName
                );
            })

            ;

        cmd.command('docs [input.ts] [output-folder]')
            .action((actionArgs: { args: string[], options: any }) => {
                let { args, options } = actionArgs;
                generateDocs(args[0], args[1]);
            })
            ;

        cmd.run();
    } catch (e) {
        console.error(chalk.red(e));

    }


}


