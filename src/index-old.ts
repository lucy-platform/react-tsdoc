import * as tsdoc from '@microsoft/tsdoc';
import * as fs from 'fs';
import * as ts from 'typescript';
import chalk from 'chalk';
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
        let prefix = '#'.repeat(level);
        this.code += `${prefix} ${title}\n\n`;
    }

    public addParagraph(p: string) {
        this.code += `${p}\n\n`;
    }

    public addCode(code: string) {
        code = code.trim();
        if (code.startsWith('```')) {
            code = code.substring(3);
        }
        if (code.endsWith('```')) {
            code = code.substring(0, code.length - 3);
        }
        this.code += `\`\`\`tsx\n${code.trim()}\n\`\`\`\n\n`
    }

    public addTable(table: any[]) {
        const tableFormat = (s: string) => {
            return s.replace(/\s+/g, ' ').replace(/\|/g, '\\|');
        }
        if (table.length == 0) {
            return;
        }
        let headers = Object.keys(table[0]);
        this.code += `|${headers.map(tableFormat).join('|')}|\n`;
        this.code += `|${headers.map(h => '-').join('|')}|\n`;
        for (let row of table) {
            this.code += `|${headers.map(h => tableFormat(row[h])).join('|')}|\n`;
        }
        this.code += '\n';
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
    isOptional?: boolean;
    defaultValue?: string;
    exampleValue?: string;
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
// Replace the existing parseInterfaceDeclaration function
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
        let memberName = member.name.getText();
        let memberType = member.type.getText();
        let mdoc = extractComment(member);
        let isOptional = member.questionToken !== undefined;

        // Parse JSDoc for @default and @example
        let defaultValue: string | undefined;
        let exampleValue: string | undefined;

        try {
            const defaultMatch = mdoc.match(/@default\s+(.+)/);
            const exampleMatch = mdoc.match(/@example\s+(.+)/);
            defaultValue = defaultMatch ? defaultMatch[1].trim() : undefined;
            exampleValue = exampleMatch ? exampleMatch[1].trim() : undefined;
        } catch { }

        inf.members.push({
            comment: mdoc,
            name: memberName,
            type: isOptional ? memberType : memberType,
            isOptional,
            defaultValue,
            exampleValue
        });
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

    const init = decl.initializer;
    const declaredType = (decl as any).type as ts.TypeNode | undefined;

    // Handle hooks (name starts with 'use')
    if (name.startsWith('use')) {
        const parameters: IReactHookParam[] = [];
        let hookReturnType = 'void'; // Default to void if no type is specified

        if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) {
            if (init.parameters) {
                for (const param of init.parameters) {
                    const pname = param.name?.getText() || 'arg';
                    const ptype = param.type ? param.type.getText() : 'any';
                    parameters.push({ name: pname, type: ptype });
                }
            }

            if (init.type) {
                hookReturnType = init.type.getText();
            } else if (checker) {
                // Attempt to infer return type from the initializer
                const body = init.body;
                if (body && ts.isBlock(body)) {
                    const lastStatement = body.statements[body.statements.length - 1];
                    if (lastStatement && ts.isReturnStatement(lastStatement) && lastStatement.expression) {
                        const type = checker.getTypeAtLocation(lastStatement.expression);
                        hookReturnType = checker.typeToString(type);
                    }
                } else if (ts.isArrowFunction(init) && init.body && !ts.isBlock(init.body)) {
                    const type = checker.getTypeAtLocation(init.body);
                    hookReturnType = checker.typeToString(type);
                }
            }
        }

        if (declaredType) {
            const typeText = declaredType.getText();
            const match = typeText.match(/\(\s*[^)]*\)\s*=>\s*(.+)$/);
            hookReturnType = match ? match[1].trim() : typeText;
        }

        docInfo.hooks[name] = {
            name,
            type: hookReturnType,
            parameters,
            comment
        };
        return; // Don't process as function or component
    }

    // Analyze component patterns
    if (init) {
        const componentInfo = analyzeComponentPattern(init, name, comment, checker, docInfo, declaredType);
        if (componentInfo) {
            docInfo.components[name] = componentInfo;
            return; // Don't process as function
        }
    }

    // Handle regular functions
    if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) {
        const params: IFunctionParam[] = [];
        if (init.parameters) {
            for (const param of init.parameters) {
                const pname = param.name?.getText() || 'arg';
                const ptype = param.type ? param.type.getText() : 'any';
                params.push({ name: pname, type: ptype });
            }
        }

        let returnType = 'void';

        if (declaredType) {
            const typeText = declaredType.getText();
            if (docInfo.functions[typeText] || docInfo.typeAliases?.[typeText]) {
                returnType = typeText;
            } else {
                const match = typeText.match(/^\([^)]*\)\s*=>\s*(.+)$/) || typeText.match(/=>\s*(.+)$/);
                returnType = match ? match[1].trim() : typeText;
            }
        } else if (init.type) {
            returnType = init.type.getText();
        } else if (checker) {
            // Infer return type from initializer
            const body = init.body;
            if (body && ts.isBlock(body)) {
                const lastStatement = body.statements[body.statements.length - 1];
                if (lastStatement && ts.isReturnStatement(lastStatement) && lastStatement.expression) {
                    const type = checker.getTypeAtLocation(lastStatement.expression);
                    returnType = checker.typeToString(type);
                }
            } else if (ts.isArrowFunction(init) && init.body && !ts.isBlock(init.body)) {
                const type = checker.getTypeAtLocation(init.body);
                returnType = checker.typeToString(type);
            }
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

function analyzeComponentPattern(init: ts.Expression, name: string, comment: string, checker: ts.TypeChecker, docInfo: IDocInfo, declaredType?: ts.TypeNode): IReactComponent | null {
    const { inner, wrappers } = unwrapCallWrappers(init);
    let parsedWrappers: string[] = wrappers.filter(w => /\b(React\.)?(memo|forwardRef)$/.test(w));

    // Helper to parse type text
    function parseTypeText(typeText: string): { type?: 'class' | 'functional' | 'forwardRef', propType?: string, refType?: string, stateType?: string, innerWrappers?: string[] } | null {
        if (/\b(React\.)?MemoExoticComponent\b/.test(typeText)) {
            const innerMatch = typeText.match(/<([^>]+)>/);
            if (!innerMatch) return null;
            const innerType = innerMatch[1].trim();
            const innerParsed = parseTypeText(innerType);
            if (innerParsed) {
                return { ...innerParsed, innerWrappers: [...(innerParsed.innerWrappers || []), 'memo'] };
            }
            const propMatch = innerType.match(/React\.FunctionComponent<([^>]+)>/) || innerType.match(/React\.FC<([^>]+)>/);
            return {
                type: 'functional',
                propType: propMatch ? propMatch[1].trim() : 'any',
                innerWrappers: ['memo']
            };
        }

        if (/\b(React\.)?ForwardRefExoticComponent\b/.test(typeText)) {
            const frMatch = typeText.match(/<React\.RefAttributes<([^>]+)>\s*&\s*([^>]+)>/);
            if (frMatch) {
                return {
                    type: 'forwardRef',
                    refType: frMatch[1].trim(),
                    propType: frMatch[2].trim()
                };
            }
            return { type: 'forwardRef', refType: 'any', propType: 'any' };
        }

        if (/\b(React\.)?(FunctionComponent|FC)\b/.test(typeText)) {
            const propMatch = typeText.match(/<\s*([^>,]+)/);
            return {
                type: 'functional',
                propType: propMatch ? propMatch[1].trim() : 'any'
            };
        }

        if (/\b(React\.)?Component\b/.test(typeText)) {
            const compMatch = typeText.match(/<([^,]+)(?:,\s*([^>]+))?/);
            return {
                type: 'class',
                propType: compMatch ? compMatch[1].trim() : 'any',
                stateType: compMatch && compMatch[2] ? compMatch[2].trim() : 'any'
            };
        }

        return null;
    }

    // Prefer explicit declared type if present
    if (declaredType) {
        const typeText = declaredType.getText();
        const parsed = parseTypeText(typeText);
        if (parsed) {
            return {
                comment,
                name,
                propType: parsed.propType || '',
                refType: parsed.refType,
                stateType: parsed.stateType,
                type: parsed.type,
                wrappers: parsed.innerWrappers || [],
                referencedComponent: ts.isIdentifier(inner) ? inner.getText() : undefined
            };
        }
    }

    // Fallback to structural analysis
    const isWrappedForwardRef = parsedWrappers.some(w => /\b(React\.)?forwardRef$/.test(w));
    const isWrappedMemo = parsedWrappers.some(w => /\b(React\.)?memo$/.test(w));

    if (isWrappedForwardRef || isWrappedMemo) {
        let propType: string | undefined;
        let refType: string | undefined;
        let componentType: 'functional' | 'forwardRef' = 'functional';
        let referencedComponent: string | undefined;

        if ((ts.isArrowFunction(inner) || ts.isFunctionExpression(inner)) && inner.parameters && inner.parameters.length > 0) {
            const firstParam = inner.parameters[0];
            propType = firstParam.type ? firstParam.type.getText() : 'any';

            if (isWrappedForwardRef && inner.parameters.length > 1) {
                const secondParam = inner.parameters[1];
                refType = secondParam.type ? secondParam.type.getText() : undefined;
                componentType = 'forwardRef';
            }
        } else if (ts.isIdentifier(inner)) {
            // Handle memo-wrapped identifier (referenced component)
            const referencedName = inner.getText();
            referencedComponent = referencedName;
            const symbol = checker.getSymbolAtLocation(inner);
            if (symbol && symbol.declarations) {
                const decl = symbol.declarations[0];
                if (ts.isVariableDeclaration(decl) && decl.type) {
                    const typeText = decl.type.getText();
                    const propMatch = typeText.match(/React\.FunctionComponent<([^>]+)>/) || typeText.match(/React\.FC<([^>]+)>/);
                    propType = propMatch ? propMatch[1].trim() : 'any';
                }
            }
        }

        return {
            comment,
            propType: propType || 'any',
            refType,
            name,
            type: componentType,
            wrappers: parsedWrappers,
            referencedComponent
        };
    }

    // Handle identifier references to other components
    if (ts.isIdentifier(inner)) {
        const referencedName = inner.getText();

        if (docInfo.components[referencedName]) {
            const referencedComponent = docInfo.components[referencedName];
            return {
                comment,
                propType: referencedComponent.propType,
                refType: referencedComponent.refType,
                stateType: referencedComponent.stateType,
                name,
                type: referencedComponent.type,
                wrappers: parsedWrappers,
                referencedComponent: referencedName
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
                    let stateType = 'any';
                    if (first.typeArguments && first.typeArguments.length >= 1) {
                        propType = first.typeArguments[0].getText();
                        if (first.typeArguments.length >= 2) {
                            stateType = first.typeArguments[1].getText();
                        }
                    }

                    return {
                        comment,
                        propType,
                        stateType,
                        name,
                        type: 'class',
                        wrappers: parsedWrappers
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
            type: 'class'
        };
    }
}

function parseFunctionDeclaration(node: ts.Node, docInfo: IDocInfo, checker?: ts.TypeChecker) {
    if (!ts.isFunctionDeclaration(node)) return;
    const name = node.name?.getText();
    if (!name) return;

    const comment = extractComment(node) || '';

    // Handle hooks
    if (name.startsWith('use')) {
        const parameters: IReactHookParam[] = [];
        let hookReturnType = 'void'; // Default to void if no type is specified

        if (node.parameters) {
            for (const p of node.parameters) {
                const pname = p.name?.getText?.() ?? 'arg';
                let ptype = p.type ? p.type.getText() : 'any';
                parameters.push({ name: pname, type: ptype });
            }
        }

        // If type is explicitly defined, use it
        if (node.type) {
            hookReturnType = node.type.getText();
        } else {
            // Attempt to infer return type if not explicitly defined
            const body = node.body;
            if (body && checker) {
                const lastStatement = body.statements[body.statements.length - 1];
                if (lastStatement && ts.isReturnStatement(lastStatement) && lastStatement.expression) {
                    const type = checker.getTypeAtLocation(lastStatement.expression);
                    hookReturnType = checker.typeToString(type);
                }
            }
        }

        docInfo.hooks[name] = {
            name,
            type: hookReturnType,
            parameters,
            comment
        };
        return; // Don't add to functions
    }

    // Capture function signature
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
    } else if (checker) {
        // Infer return type if not explicitly defined
        const signature = checker.getSignatureFromDeclaration(node);
        if (signature) {
            const returnTypeFromSignature = checker.getReturnTypeOfSignature(signature);
            returnType = checker.typeToString(returnTypeFromSignature);
        }
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

    // Collect from components with @export
    Object.values(docInfo.components).forEach(comp => {
        if (hasExportAnnotation(comp.comment)) {
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

            // Collect from referenced components
            if (comp.referencedComponent && docInfo.components[comp.referencedComponent]) {
                const refComp = docInfo.components[comp.referencedComponent];
                const refPropTypes = extractTypeNames(refComp.propType);
                refPropTypes.forEach(t => collectDependencies(t));

                if (refComp.stateType) {
                    const refStateTypes = extractTypeNames(refComp.stateType);
                    refStateTypes.forEach(t => collectDependencies(t));
                }

                if (refComp.refType) {
                    const refRefTypes = extractTypeNames(refComp.refType);
                    refRefTypes.forEach(t => collectDependencies(t));
                }
            }
        }
    });

    // Collect from functions with @export
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

    // Collect from hooks with @export
    Object.values(docInfo.hooks).forEach(hook => {
        if (hasExportAnnotation(hook.comment)) {
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

function generateComplexComponentType(comp: IReactComponent, docInfo: IDocInfo, linkTypes?: boolean): string {
    let baseType = '';

    // Helper function to conditionally link types
    const typeHelper = linkTypes ?
        (type: string) => linkedType(type, docInfo) :
        (type: string) => type;

    // If this component references another component, use the referenced component's details
    if (comp.referencedComponent && docInfo.components[comp.referencedComponent]) {
        const referencedComp = docInfo.components[comp.referencedComponent];

        if (referencedComp.type === 'class') {
            baseType = `React.Component<${typeHelper(referencedComp.propType)}, ${typeHelper(referencedComp.stateType || 'any')}>`;
        } else if (referencedComp.type === 'forwardRef') {
            baseType = `React.ForwardRefExoticComponent<React.RefAttributes<${typeHelper(referencedComp.refType || 'any')}> & ${typeHelper(referencedComp.propType)}>`;
        } else {
            baseType = `React.FunctionComponent<${typeHelper(referencedComp.propType)}>`;
        }
    } else {
        // Generate type for the component itself
        if (comp.type === 'class') {
            baseType = `React.Component<${typeHelper(comp.propType)}, ${typeHelper(comp.stateType || 'any')}>`;
        } else if (comp.type === 'forwardRef') {
            baseType = `React.ForwardRefExoticComponent<React.RefAttributes<${typeHelper(comp.refType || 'any')}> & ${typeHelper(comp.propType)}>`;
        } else {
            baseType = `React.FunctionComponent<${typeHelper(comp.propType)}>`;
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

    // Emit all dependent types with export keyword
    for (const typeName of dependentTypes) {
        if (emitted.has(typeName)) continue;

        if (docInfo.interfaces?.[typeName]) {
            const intf = docInfo.interfaces[typeName];
            // Remove any existing 'export' keyword to avoid duplication
            const cleanCode = intf.code.replace(/^\s*export\s*/, '');
            const toEmit = '\n' + intf.comment + '\n' + 'export ' + cleanCode + '\n';
            code += indentCode(toEmit, '    ');
            emitted.add(typeName);
        } else if (docInfo.unions?.[typeName]) {
            const union = docInfo.unions[typeName];
            // Remove any existing 'export' keyword to avoid duplication
            const cleanCode = union.code.replace(/^\s*export\s*/, '');
            const toEmit = '\n' + union.comment + '\n' + 'export ' + cleanCode + '\n';
            code += indentCode(toEmit, '    ');
            emitted.add(typeName);
        } else if (docInfo.enums?.[typeName]) {
            const enumObj = docInfo.enums[typeName];
            // Remove any existing 'declare' or 'export' keyword to avoid duplication
            const cleanCode = enumObj.code.replace(/^\s*(declare|export)\s*/, '');
            const toEmit = '\n' + enumObj.comment + '\n' + 'export ' + cleanCode + '\n';
            code += indentCode(toEmit, '    ');
            emitted.add(typeName);
        } else if (docInfo.typeAliases?.[typeName]) {
            const alias = docInfo.typeAliases[typeName];
            // Remove any existing 'export' keyword to avoid duplication
            const cleanCode = alias.code.replace(/^\s*export\s*/, '');
            const toEmit = '\n' + alias.comment + '\n' + 'export ' + cleanCode + '\n';
            code += indentCode(toEmit, '    ');
            emitted.add(typeName);
        } else if (docInfo.functions?.[typeName]) {
            const func = docInfo.functions[typeName];
            // Remove any existing 'export' keyword to avoid duplication
            const cleanCode = func.code.replace(/^\s*export\s*/, '');
            const paramsTxt = func.parameters.map(p => `${p.name}: ${p.type}`).join(', ');
            const commentBlock = func.comment ? '\n' + func.comment + '\n' : '\n';
            const declaration = `export type ${typeName} = (${paramsTxt}) => ${func.return};\n`;
            code += indentCode(commentBlock + declaration, '    ');
            emitted.add(typeName);
        }
    }

    // Emit components with @export and proper complex types
    Object.values(docInfo.components).forEach(comp => {
        if (emitted.has(comp.name)) return;

        if (hasExportAnnotation(comp.comment)) {
            const complexType = generateComplexComponentType(comp, docInfo);
            const commentBlock = comp.comment ? '\n' + comp.comment + '\n' : '\n';
            const declaration = `export const ${comp.name}: ${complexType};\n`;
            code += indentCode(commentBlock + declaration, '    ');
            emitted.add(comp.name);
        }
    });

    // Emit functions with @export (excluding those already emitted as dependencies)
    Object.keys(docInfo.functions).forEach(fname => {
        if (emitted.has(fname)) return;
        const f = docInfo.functions[fname];

        if (hasExportAnnotation(f.comment)) {
            const paramsTxt = f.parameters.map(p => `${p.name}: ${p.type}`).join(', ');
            const commentBlock = f.comment ? '\n' + f.comment + '\n' : '\n';
            const declaration = `export function ${fname}(${paramsTxt}): ${f.return};\n`;
            code += indentCode(commentBlock + declaration, '    ');
            emitted.add(fname);
        }
    });

    // Emit hooks with @export
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
// function generateComponentDoc(cdoc: IComponentDocumentation, docs: IDocObject) {
//     let md = new MarkdownBuilder();
//     md.addTitle(cdoc.name, 1)
//     md.addParagraph(cdoc.summary);
//     md.addTitle('Installation', 2);
//     md.addCode(`import {${cdoc.name}} from 'uxp/components';`);
//     if (cdoc.examples.length > 0) {
//         md.addTitle('Examples', 2);
//         for (let i in cdoc.examples) {
//             md.addCode(cdoc.examples[i].summary)
//         }
//     }
//     if (cdoc.props.length > 0) {

//         md.addTitle('Properties', 2);
//         md.addTable(cdoc.props.map(p => ({ Name: p.name, Type: linkedType(p.type, docs), Description: p.summary })));
//         for (let i in cdoc.props) {
//             let prop = cdoc.props[i];
//             md.addTitle(prop.name, 3);
//             md.addParagraph('---');
//             md.addParagraph(prop.summary);
//             md.addTable([{ 'type': linkedType(prop.type, docs) }]);

//             for (let j in prop.examples) {
//                 md.addCode(prop.examples[j].summary);
//             }
//         }

//     }
//     return md.toString();
// }




// Helper function to extract types from complex component declarations
function extractTypesFromComplex(comp: IReactComponent, docInfo: IDocInfo): { propType: string, refType?: string } {
    // Use the same logic as generateComplexComponentType but extract instead of generate

    let actualComp = comp;
    // If this component references another component, use the referenced component's details
    if (comp.referencedComponent && docInfo.components[comp.referencedComponent]) {
        actualComp = docInfo.components[comp.referencedComponent];
    }

    return {
        propType: actualComp.propType,
        refType: actualComp.refType
    };
}

function generateComponentDocFromDocInfo(comp: IReactComponent, docInfo: IDocInfo, moduleName?: string, dependentTypes?: Set<string>) {
    let md = new MarkdownBuilder();
    const [summary, examples] = parseTSDocComment(comp.comment);

    md.addTitle(comp.name, 1);
    if (summary) md.addParagraph(summary);

    // Installation
    md.addTitle('Installation', 2);
    const moduleImport = moduleName || 'your-module';
    md.addCode(`import { ${comp.name} } from '${moduleImport}';`);

    // Signature
    md.addTitle('Signature', 2);
    const complexType = generateComplexComponentType(comp, docInfo, false);
    md.addCode(`const ${comp.name}: ${complexType}`);

    // Examples
    if (examples.length > 0) {
        md.addTitle('Examples', 2);
        for (let example of examples) {
            md.addCode(example.summary);
        }
    }

    const { propType, refType } = extractTypesFromComplex(comp, docInfo);

    // Properties from interface
    const propInterface = docInfo.interfaces[propType];
    if (propInterface && propInterface.members.length > 0) {
        md.addTitle('Properties', 2);
        const propTableData = propInterface.members.map(member => ({
            Name: member.name,
            Type: linkedType(member.type, docInfo),
            Mandatory: member.isOptional ? 'No' : 'Yes',
            'Default Value': member.defaultValue || '-',
            'Example Value': member.exampleValue || '-'
        }));
        md.addTable(propTableData);
    }

    // Forward ref handlers
    if (refType) {
        const refInterface = docInfo.interfaces[refType];
        if (refInterface && refInterface.members.length > 0) {
            md.addTitle('Ref Handlers', 2);
            md.addParagraph('Available methods through ref:');
            const handlersTable = refInterface.members.map(member => {
                const [memberSummary] = parseTSDocComment(member.comment || '');
                return {
                    Method: member.name,
                    Type: linkedType(member.type, docInfo),
                    Description: memberSummary || '-'
                };
            });
            md.addTable(handlersTable);
        }
    }

    // Related Types section
    if (dependentTypes) {
        const relatedTypes = getRelatedTypes(comp, dependentTypes, docInfo);
        if (relatedTypes.length > 0) {
            md.addTitle('Related Types', 2);
            const typeLinks = relatedTypes.map(typeName => `- [${typeName}](../types/${typeName}.md)`).join('\n');
            md.addParagraph(typeLinks);
        }
    }

    return md.toString();
}

function generateHookDocFromDocInfo(hook: IReactHook, docInfo: IDocInfo, moduleName?: string, dependentTypes?: Set<string>) {
    let md = new MarkdownBuilder();
    const [summary, examples] = parseTSDocComment(hook.comment);

    md.addTitle(hook.name, 1);
    if (summary) md.addParagraph(summary);

    md.addTitle('Installation', 2);
    const moduleImport = moduleName || 'your-module';
    md.addCode(`import { ${hook.name} } from '${moduleImport}';`);

    md.addTitle('Signature', 2);
    const params = hook.parameters.map(p => `${p.name}: ${p.type}`).join(', ');
    md.addCode(`function ${hook.name}(${params}): ${hook.type}`);

    if (examples.length > 0) {
        md.addTitle('Examples', 2);
        for (let example of examples) {
            md.addCode(example.summary);
        }
    }

    if (dependentTypes) {
        const relatedTypes = getRelatedTypes(hook, dependentTypes, docInfo);
        if (relatedTypes.length > 0) {
            md.addTitle('Related Types', 2);
            const typeLinks = relatedTypes.map(typeName => `- [${typeName}](../types/${typeName}.md)`).join('\n');
            md.addParagraph(typeLinks);
        }
    }

    return md.toString();
}

function generateFunctionDocFromDocInfo(func: IFunctionSignature, docInfo: IDocInfo, moduleName?: string, dependentTypes?: Set<string>) {
    let md = new MarkdownBuilder();
    const [summary, examples] = parseTSDocComment(func.comment);

    const functionName = Object.keys(docInfo.functions).find(key => docInfo.functions[key] === func) || 'function';

    md.addTitle(functionName, 1);
    if (summary) md.addParagraph(summary);

    md.addTitle('Installation', 2);
    const moduleImport = moduleName || 'your-module';
    md.addCode(`import { ${functionName} } from '${moduleImport}';`);

    md.addTitle('Signature', 2);
    const params = func.parameters.map(p => `${p.name}: ${p.type}`).join(', ');
    const signature = `function ${functionName}(${params}): ${func.return}`;
    md.addCode(signature);

    if (examples.length > 0) {
        md.addTitle('Examples', 2);
        for (let example of examples) {
            md.addCode(example.summary);
        }
    }

    if (dependentTypes) {
        const relatedTypes = getRelatedTypes(func, dependentTypes, docInfo);
        if (relatedTypes.length > 0) {
            md.addTitle('Related Types', 2);
            const typeLinks = relatedTypes.map(typeName => `- [${typeName}](../types/${typeName}.md)`).join('\n');
            md.addParagraph(typeLinks);
        }
    }

    return md.toString();
}

function generateTypeDocFromDocInfo(typeInfo: any, typeKind: 'interface' | 'union' | 'enum' | 'type', docInfo: IDocInfo, moduleName?: string, dependentTypes?: Set<string>) {
    let md = new MarkdownBuilder();
    const [summary, examples] = parseTSDocComment(typeInfo.comment);

    md.addTitle(typeInfo.name, 1);
    if (summary) md.addParagraph(summary);

    md.addTitle('Definition', 2);
    md.addCode(typeInfo.code);

    md.addTitle('Usage', 2);
    const moduleImport = moduleName || 'your-module';
    md.addCode(`import { ${typeInfo.name} } from '${moduleImport}';`);

    if (examples.length > 0) {
        md.addTitle('Examples', 2);
        for (let example of examples) {
            md.addCode(example.summary);
        }
    }

    if (dependentTypes) {
        const relatedTypes: string[] = [];

        if (typeKind === 'interface' && typeInfo.members) {
            typeInfo.members.forEach((member: any) => {
                if (member.type && dependentTypes.has(member.type)) {
                    relatedTypes.push(member.type);
                }
            });
        }

        if (typeKind === 'union' && typeInfo.items) {
            typeInfo.items.forEach((item: string) => {
                if (dependentTypes.has(item)) {
                    relatedTypes.push(item);
                }
            });
        }

        const uniqueRelatedTypes = [...new Set(relatedTypes)];
        if (uniqueRelatedTypes.length > 0) {
            md.addTitle('Related Types', 2);
            const typeLinks = uniqueRelatedTypes.map(typeName => `- [${typeName}](../types/${typeName}.md)`).join('\n');
            md.addParagraph(typeLinks);
        }
    }

    return md.toString();
}

function getRelatedTypes(item: { propType?: string, refType?: string, stateType?: string, parameters?: any[], return?: string, type?: string }, dependentTypes: Set<string>, docInfo: IDocInfo): string[] {
    const relatedTypes: string[] = [];
    const visited = new Set<string>();

    // Helper to extract type names from type strings
    function extractTypeNames(typeStr: string): string[] {
        if (!typeStr) return [];

        // More comprehensive type extraction regex
        const typePattern = /\b([A-Z][a-zA-Z0-9]*)\b/g;
        const matches = [];
        let match;

        while ((match = typePattern.exec(typeStr)) !== null) {
            const typeName = match[1];
            // Filter out built-in types
            if (!['React', 'Promise', 'Array', 'Map', 'Set', 'Date', 'Error', 'String', 'Number', 'Boolean'].includes(typeName)) {
                matches.push(typeName);
            }
        }

        return matches;
    }

    // Recursively collect all related types
    function collectRelatedTypes(typeName: string) {
        if (visited.has(typeName) || !dependentTypes.has(typeName)) {
            return;
        }

        visited.add(typeName);
        relatedTypes.push(typeName);

        // Check interfaces
        if (docInfo.interfaces?.[typeName]) {
            const intf = docInfo.interfaces[typeName];

            // Extract types from extends clause
            const extendsMatch = intf.code.match(/extends\s+([^{]+)/);
            if (extendsMatch) {
                const extendedTypes = extractTypeNames(extendsMatch[1]);
                extendedTypes.forEach(t => collectRelatedTypes(t));
            }

            // Extract types from member types
            intf.members.forEach(member => {
                const memberTypes = extractTypeNames(member.type);
                memberTypes.forEach(t => collectRelatedTypes(t));
            });
        }

        // Check unions
        if (docInfo.unions?.[typeName]) {
            const union = docInfo.unions[typeName];
            union.items.forEach(item => {
                const itemTypes = extractTypeNames(item);
                itemTypes.forEach(t => collectRelatedTypes(t));
            });
        }

        // Check type aliases
        if (docInfo.typeAliases?.[typeName]) {
            const alias = docInfo.typeAliases[typeName];
            const aliasTypes = extractTypeNames(alias.type);
            aliasTypes.forEach(t => collectRelatedTypes(t));
        }

        // Check function types
        if (docInfo.functions?.[typeName]) {
            const func = docInfo.functions[typeName];
            const returnTypes = extractTypeNames(func.return);
            returnTypes.forEach(t => collectRelatedTypes(t));

            func.parameters.forEach(param => {
                const paramTypes = extractTypeNames(param.type);
                paramTypes.forEach(t => collectRelatedTypes(t));
            });
        }
    }

    // Start collection from item's direct types
    if (item.propType) {
        collectRelatedTypes(item.propType);
    }
    if (item.refType) {
        collectRelatedTypes(item.refType);
    }
    if (item.stateType) {
        collectRelatedTypes(item.stateType);
    }

    // Check function/hook parameter and return types
    if (item.parameters) {
        item.parameters.forEach(param => {
            collectRelatedTypes(param.type);
        });
    }
    if (item.return) {
        collectRelatedTypes(item.return);
    }
    if (item.type) {
        collectRelatedTypes(item.type);
    }

    return [...new Set(relatedTypes)]; // Remove duplicates
}
// Updated linkedType function to work with docInfo
function linkedType(type: string, docInfo: IDocInfo): string {
    const cleanType = type.replace(/\[\]$/, ''); // Remove array notation for checking

    if (docInfo.interfaces[cleanType] || docInfo.unions[cleanType] ||
        docInfo.enums[cleanType] || docInfo.typeAliases?.[cleanType]) {
        return `[${type}](../types/${cleanType}.md)`;
    }
    return type;
}

function generateDocs(root: string, outputPath: string, moduleName?: string) {
    let [docInfo, docs] = load(root);
    if (outputPath.endsWith('/')) outputPath = outputPath.substring(0, outputPath.length - 1);

    // Create directories
    mkdirp.sync(outputPath + '/components/');
    mkdirp.sync(outputPath + '/types/');
    mkdirp.sync(outputPath + '/hooks/');
    mkdirp.sync(outputPath + '/functions/');

    // Collect all dependent types once
    const dependentTypes = collectAllDependentTypes(docInfo);

    // Generate component docs
    for (let cn in docInfo.components) {
        let componentInfo = docInfo.components[cn];
        if (hasExportAnnotation(componentInfo.comment)) {
            let md = generateComponentDocFromDocInfo(componentInfo, docInfo, moduleName, dependentTypes);
            let path = outputPath + '/components/' + componentInfo.name + '.md';
            console.log(chalk.gray('Writing component', componentInfo.name, 'to', path));
            fs.writeFileSync(path, md);
        }
    }

    // Generate type docs for all dependent types
    for (const typeName of dependentTypes) {
        if (docInfo.interfaces?.[typeName]) {
            const typeInfo = docInfo.interfaces[typeName];
            let md = generateTypeDocFromDocInfo(typeInfo, 'interface', docInfo, moduleName, dependentTypes);
            let path = outputPath + '/types/' + typeInfo.name + '.md';
            console.log(chalk.gray('Writing type', typeInfo.name, 'to', path));
            fs.writeFileSync(path, md);
        }

        if (docInfo.unions?.[typeName]) {
            const typeInfo = docInfo.unions[typeName];
            let md = generateTypeDocFromDocInfo(typeInfo, 'union', docInfo, moduleName, dependentTypes);
            let path = outputPath + '/types/' + typeName + '.md';
            console.log(chalk.gray('Writing type', typeName, 'to', path));
            fs.writeFileSync(path, md);
        }

        if (docInfo.enums?.[typeName]) {
            const typeInfo = docInfo.enums[typeName];
            let md = generateTypeDocFromDocInfo(typeInfo, 'enum', docInfo, moduleName, dependentTypes);
            let path = outputPath + '/types/' + typeInfo.name + '.md';
            console.log(chalk.gray('Writing type', typeInfo.name, 'to', path));
            fs.writeFileSync(path, md);
        }

        if (docInfo.typeAliases?.[typeName]) {
            const typeInfo = docInfo.typeAliases[typeName];
            let md = generateTypeDocFromDocInfo(typeInfo, 'type', docInfo, moduleName, dependentTypes);
            let path = outputPath + '/types/' + typeInfo.name + '.md';
            console.log(chalk.gray('Writing type', typeInfo.name, 'to', path));
            fs.writeFileSync(path, md);
        }

        if (docInfo.functions?.[typeName]) {
            const typeInfo = docInfo.functions[typeName];
            let md = generateFunctionDocFromDocInfo(typeInfo, docInfo, moduleName, dependentTypes);
            let path = outputPath + '/types/' + typeName + '.md';
            console.log(chalk.gray('Writing function type', typeName, 'to', path));
            fs.writeFileSync(path, md);
        }
    }

    // Generate hook docs
    for (let hn in docInfo.hooks) {
        let hookInfo = docInfo.hooks[hn];
        if (hasExportAnnotation(hookInfo.comment)) {
            let md = generateHookDocFromDocInfo(hookInfo, docInfo, moduleName, dependentTypes);
            let path = outputPath + '/hooks/' + hookInfo.name + '.md';
            console.log(chalk.gray('Writing hook', hookInfo.name, 'to', path));
            fs.writeFileSync(path, md);
        }
    }

    // Generate function docs (exclude those already generated as types)
    for (let fn in docInfo.functions) {
        if (!dependentTypes.has(fn)) {
            let functionInfo = docInfo.functions[fn];
            if (hasExportAnnotation(functionInfo.comment)) {
                let md = generateFunctionDocFromDocInfo(functionInfo, docInfo, moduleName, dependentTypes);
                let path = outputPath + '/functions/' + fn + '.md';
                console.log(chalk.gray('Writing function', fn, 'to', path));
                fs.writeFileSync(path, md);
            }
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
            .option('--module-name <name>')
            .action((actionArgs: { args: string[], options: any }) => {
                let { args, options } = actionArgs;
                generateDocs(args[0], args[1], options.moduleName);
            });

        cmd.run();
    } catch (e) {
        console.error(chalk.red(e));

    }


}


