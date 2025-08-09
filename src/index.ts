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
    stateType?: string
    refType?: string
    comment: string;
    type?: 'class' | 'functional' | 'forwardRef'
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

    // Comment is usually on the VariableStatement (parent.parent)
    const parentForComments = (decl.parent && decl.parent.parent) ? decl.parent.parent : node.parent;
    const comment = extractComment(parentForComments || node) || '';

    const safeText = (n?: ts.Node | null) => {
        try { return n ? n.getText() : undefined; } catch { return undefined; }
    };

    // Check if explicitly declared as React component via type annotation
    const declaredType = (decl as any).type as ts.TypeNode | undefined;
    if (declaredType) {
        const typeText = safeText(declaredType) || '';
        const isExplicitComponent = /\b(React\.)?(FunctionComponent|FC|ForwardRefExoticComponent|Component)\b/.test(typeText);

        if (isExplicitComponent) {
            // Extract prop and ref types from type annotation
            const propMatch = typeText.match(/<\s*([^>,]+)/);
            const refMatch = typeText.match(/RefAttributes\s*<\s*([^>]+)\s*>/);

            // Don't overwrite if already exists
            if (!docInfo.components[name]) {
                docInfo.components[name] = {
                    comment,
                    propType: propMatch ? propMatch[1].trim() : 'any',
                    refType: refMatch ? refMatch[1].trim() : undefined,
                    name,
                    type: /ForwardRefExoticComponent/.test(typeText) ? 'forwardRef' : 'functional'
                } as IReactComponent;
            }
            return;
        }
    }

    // Handle hooks - always capture if name starts with 'use'
    if (name.startsWith('use')) {
        if (!docInfo.hooks[name]) {
            const parameters: IReactHookParam[] = [];
            // Try to extract parameters from function type if available
            const init = decl.initializer;
            if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) {
                if (init.parameters) {
                    for (const param of init.parameters) {
                        const pname = param.name?.getText() || 'arg';
                        const ptype = param.type ? param.type.getText() : 'any';
                        parameters.push({ name: pname, type: ptype });
                    }
                }
            }
            docInfo.hooks[name] = { name, type: 'function', parameters, comment };
        }
        // Don't return here - hooks can also be functions
    }

    const init = decl.initializer;
    if (!init) return;

    // Unwrap wrappers like memo(forwardRef(...))
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

    const { inner, wrappers } = unwrapCallWrappers(init);
    const isWrappedForwardRef = wrappers.some(w => /\b(React\.)?forwardRef$/.test(w));
    const isWrappedMemo = wrappers.some(w => /\b(React\.)?memo$/.test(w));

    // Handle identifier references - check if it points to an already registered component
    if (ts.isIdentifier(inner)) {
        try {
            const sym = checker.getSymbolAtLocation(inner);
            if (sym && sym.declarations && sym.declarations.length > 0) {
                const targetDecl = sym.declarations[0];
                if (ts.isVariableDeclaration(targetDecl)) {
                    const targetName = targetDecl.name?.getText();
                    const referenced = targetName ? docInfo.components[targetName] : undefined;
                    if (referenced && !docInfo.components[name]) {
                        docInfo.components[name] = { ...referenced, name, comment };
                        return;
                    }
                }

                // Check if the referenced symbol has a React component type
                try {
                    const symbolType = checker.getTypeOfSymbolAtLocation(sym, targetDecl);
                    const typeString = checker.typeToString(symbolType);
                    if (/\b(FunctionComponent|ForwardRefExoticComponent|Component)\b/.test(typeString)) {
                        const propMatch = typeString.match(/<\s*([^>]+)\s*>/);
                        if (!docInfo.components[name]) {
                            docInfo.components[name] = {
                                comment,
                                propType: propMatch ? propMatch[1].trim() : 'any',
                                name,
                                type: /ForwardRefExoticComponent/.test(typeString) ? 'forwardRef' : 'functional'
                            } as IReactComponent;
                        }
                        return;
                    }
                } catch { /* ignore checker errors */ }
            }
        } catch { /* ignore resolution errors */ }
    }

    // Handle wrapped components (memo, forwardRef)
    if (isWrappedForwardRef || isWrappedMemo) {
        let propType: string | undefined;
        let refType: string | undefined;

        if ((ts.isArrowFunction(inner) || ts.isFunctionExpression(inner)) && inner.parameters && inner.parameters.length > 0) {
            const firstParam = inner.parameters[0];
            propType = firstParam.type ? firstParam.type.getText() : 'any';

            if (isWrappedForwardRef && inner.parameters.length > 1) {
                const secondParam = inner.parameters[1];
                refType = secondParam.type ? secondParam.type.getText() : undefined;
            }
        } else if (ts.isClassExpression(inner)) {
            const heritage = inner.heritageClauses;
            if (heritage && heritage.length > 0) {
                const first = heritage[0].types && heritage[0].types[0];
                if (first && first.typeArguments && first.typeArguments.length >= 1) {
                    propType = first.typeArguments[0].getText();
                }
            }
        }

        if (!docInfo.components[name]) {
            docInfo.components[name] = {
                comment,
                propType: propType || 'any',
                refType,
                name,
                type: isWrappedForwardRef ? 'forwardRef' : 'functional'
            } as IReactComponent;
        }
        return;
    }

    // Handle class expressions that extend React.Component
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

                    if (!docInfo.components[name]) {
                        docInfo.components[name] = {
                            comment,
                            propType,
                            name,
                            type: 'class'
                        } as IReactComponent;
                    }
                    return;
                }
            }
        }
    }

    // For everything else (plain arrow functions, function expressions), treat as regular functions
    // Extract function signature for documentation
    if ((ts.isArrowFunction(inner) || ts.isFunctionExpression(inner)) && !docInfo.functions[name]) {
        const params: IFunctionParam[] = [];

        if (inner.parameters) {
            for (const param of inner.parameters) {
                const pname = param.name?.getText() || 'arg';
                const ptype = param.type ? param.type.getText() : 'any';
                params.push({ name: pname, type: ptype });
            }
        }

        // Determine return type - check declared type first, then infer
        let returnType = 'any';

        // If there's a declared type (like TestFunction), resolve it
        if (declaredType) {
            const typeText = declaredType.getText();

            // Check if it's a reference to a type alias
            if (docInfo.functions[typeText]) {
                // It's a function type alias
                returnType = docInfo.functions[typeText].return;
            } else {
                try {
                    const declaredTypeObj = checker.getTypeFromTypeNode(declaredType);
                    const signatures = checker.getSignaturesOfType(declaredTypeObj, ts.SignatureKind.Call);
                    if (signatures && signatures.length > 0) {
                        const returnTypeObj = checker.getReturnTypeOfSignature(signatures[0]);
                        returnType = checker.typeToString(returnTypeObj);
                    }
                } catch {
                    // Fallback to text representation
                    const match = typeText.match(/^\([^)]*\)\s*=>\s*(.+)$/) || typeText.match(/=>\s*(.+)$/);
                    returnType = match ? match[1].trim() : 'void';
                }
            }
        } else if (inner.type) {
            returnType = inner.type.getText();
        } else if (checker) {
            try {
                const type = checker.getTypeAtLocation(inner);
                const signatures = checker.getSignaturesOfType(type, ts.SignatureKind.Call);
                if (signatures && signatures.length > 0) {
                    const returnTypeObj = checker.getReturnTypeOfSignature(signatures[0]);
                    returnType = checker.typeToString(returnTypeObj);
                }
            } catch { /* ignore */ }
        }

        const fnSig: IFunctionSignature = {
            parameters: params,
            return: returnType,
            comment,
            code: getCode(decl)
        };

        docInfo.functions[name] = fnSig;
    }
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

    try {
        const first = heritage.types[0];
        const baseText = first.expression ? first.expression.getText() : '';
        const isReactComponentBase = /\b(React\.)?Component\b/.test(baseText) || /\b(React\.)?PureComponent\b/.test(baseText);

        if (!isReactComponentBase && checker) {
            // try resolving the base type symbol via checker
            try {
                const baseType = checker.getTypeAtLocation(first.expression);
                if (baseType && baseType.symbol && /Component/.test(baseType.symbol.getName())) {
                    // ok, treat as component
                } else {
                    return;
                }
            } catch {
                return;
            }
        } else if (!isReactComponentBase) {
            return;
        }

        // extract type arguments for props/state if present
        let propType: string | undefined;
        if (first.typeArguments && first.typeArguments.length >= 1) {
            propType = first.typeArguments[0].getText();
        }

        docInfo.components[name] = {
            comment,
            propType: propType || 'any',
            name,
            type: 'class'
        } as IReactComponent;
    } catch (err) {
        logWarning('Error parsing class declaration', err);
    }
}

function parseFunctionDeclaration(node: ts.Node, docInfo: IDocInfo, checker?: ts.TypeChecker) {
    if (!ts.isFunctionDeclaration(node)) return;
    const name = node.name?.getText();
    if (!name) return;

    const comment = extractComment(node) || '';
    const code = getCode(node);

    // --- If it's a hook (name starts with 'use'), register as a hook (keep previous behavior) ---
    if (name.startsWith('use') && !docInfo.hooks[name]) {
        const parameters: IReactHookParam[] = [];
        if (node.parameters) {
            for (const p of node.parameters) {
                const pname = p.name?.getText?.() ?? 'arg';
                let ptype = p.type ? p.type.getText() : 'any';
                if (ptype === 'any' && checker) {
                    try {
                        const pt = checker.getTypeAtLocation(p);
                        ptype = checker.typeToString(pt);
                    } catch { /* ignore */ }
                }
                parameters.push({ name: pname, type: ptype });
            }
        }
        docInfo.hooks[name] = { name, type: 'function', parameters, comment };
    }

    // --- Capture the function signature into docInfo.functions ---
    if (!docInfo.functions[name]) {
        // Build parameter list
        const params: IFunctionParam[] = [];
        if (node.parameters) {
            for (const p of node.parameters) {
                const pname = p.name?.getText?.() ?? 'arg';
                let ptype = p.type ? p.type.getText() : 'any';
                if (ptype === 'any' && checker) {
                    try {
                        const pt = checker.getTypeAtLocation(p);
                        ptype = checker.typeToString(pt);
                    } catch { /* ignore */ }
                }
                params.push({ name: pname, type: ptype });
            }
        }

        // Determine return type (use explicit annotation if present, else try checker)
        let returnType = 'void';
        if (node.type) {
            try {
                returnType = node.type.getText();
            } catch {
                returnType = 'any';
            }
        } else if (checker) {
            try {
                const sig = checker.getSignatureFromDeclaration(node);
                if (sig) {
                    const r = checker.getReturnTypeOfSignature(sig);
                    returnType = checker.typeToString(r);
                }
            } catch { /* ignore */ }
        }

        const fnSig: IFunctionSignature = {
            parameters: params,
            return: returnType,
            comment,
            code
        };

        docInfo.functions[name] = fnSig;
    }
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

        const fnSig: IFunctionSignature = {
            parameters,
            return: returnType,
            comment,
            code
        };

        // Don't overwrite if already exists
        if (!docInfo.functions[name]) {
            docInfo.functions[name] = fnSig;
        }
        return;
    }

    if (type.kind === ts.SyntaxKind.UnionType) {
        // Union type alias
        const unionType = type as ts.UnionTypeNode;
        const items: string[] = [];

        for (const unionMember of unionType.types) {
            items.push(unionMember.getText());
        }

        const union: IUnion = { items, comment, code };

        // Don't overwrite if already exists
        if (!docInfo.unions[name]) {
            docInfo.unions[name] = union;
        }
        return;
    }

    // Regular type alias (not function or union)
    // Add as interface-like type for consistency
    const inf: IInterfaceDeclaration = {
        comment,
        members: [],
        name,
        code
    };

    // Don't overwrite if already exists
    if (!docInfo.interfaces[name]) {
        docInfo.interfaces[name] = inf;
    }
}

function walkTree(node: ts.Node, docInfo: IDocInfo, checker: ts.TypeChecker) {
    switch (node.kind) {
        case ts.SyntaxKind.TypeAliasDeclaration:
            parseTypeAlias(node, docInfo);
            break;
        case ts.SyntaxKind.InterfaceDeclaration:
            parseInterfaceDeclaration(node, docInfo);
            break;
        case ts.SyntaxKind.VariableDeclaration:
            parseVariableDeclaration(node, docInfo, checker);
            break;
        case ts.SyntaxKind.ClassDeclaration:
            parseClassDeclaration(node, docInfo, checker);
            break;
        case ts.SyntaxKind.FunctionDeclaration:
            // IMPORTANT: per ground rules, FunctionDeclaration (e.g. `function X(){}`) is NOT a "declared component".
            // We still parse it for hooks or regular function types but we will NOT treat it as a component.
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

function generateExportModule(docs: IDocObject, docInfo: IDocInfo, options: IExportModuleOptions) {
    let code = '';
    const openedModule = !!(options && options.moduleName);
    if (openedModule) {
        code += `declare module "${options.moduleName}" {\n`;
    }

    const emitted = new Set<string>();
    const referencedTypes = collectReferencedTypes(docInfo);

    const isExplicitlyExported = (rawComment: string | undefined) => {
        if (!rawComment) return false;
        try {
            const [, , flags] = parseTSDocComment(rawComment);
            return (flags & ComponentFlags.Export) === ComponentFlags.Export;
        } catch {
            return false;
        }
    };

    // Emit referenced types first (interfaces and unions that are used by exported items)
    for (const typeName of referencedTypes) {
        if (emitted.has(typeName)) continue;

        // Check interfaces
        const interfaceObj = docInfo.interfaces[typeName];
        if (interfaceObj) {
            const toEmit = '\n' + interfaceObj.comment + '\n' + interfaceObj.code + '\n';
            code += indentCode(toEmit, '    ');
            emitted.add(typeName);
            continue;
        }

        // Check unions
        const unionObj = docInfo.unions[typeName];
        if (unionObj) {
            const toEmit = '\n' + unionObj.comment + '\n' + unionObj.code + '\n';
            code += indentCode(toEmit, '    ');
            emitted.add(typeName);
            continue;
        }
    }

    // Emit explicitly exported types
    for (let i in docs.types) {
        const obj = docs.types[i];
        const name = obj.name;
        if (emitted.has(name)) continue;

        let rawComment = '';
        if (docInfo.interfaces[obj.name]) rawComment = docInfo.interfaces[obj.name].comment;
        else if (docInfo.functions[obj.name]) rawComment = docInfo.functions[obj.name].comment;
        else if (docInfo.unions[obj.name]) rawComment = docInfo.unions[obj.name].comment;

        if (!isExplicitlyExported(rawComment)) continue;

        if (obj.type === 'interface' || obj.type === 'union') {
            const toEmit = '\n' + (rawComment || '') + '\n' + 'export ' + obj.code + '\n';
            code += indentCode(toEmit, '    ');
            emitted.add(name);
            continue;
        }

        if (obj.type === 'function') {
            const fn = docInfo.functions[obj.name];
            if (fn) {
                const paramsTxt = fn.parameters.map(p => `${p.name}: ${p.type}`).join(', ');
                const ret = fn.return || 'void';
                const commentBlock = fn.comment ? '\n' + fn.comment + '\n' : '\n';
                const decl = `export function ${obj.name}(${paramsTxt}): ${ret};\n`;
                code += indentCode(commentBlock + decl, '    ');
                emitted.add(name);
            } else {
                const stripped = obj.code.replace(/\{[\s\S]*\}$/, ';');
                const toEmit = '\n' + (rawComment || '') + '\n' + 'export ' + stripped + '\n';
                code += indentCode(toEmit, '    ');
                emitted.add(name);
            }
            continue;
        }
    }

    // Emit exported components
    for (let i in docs.components) {
        const doc = docs.components[i];
        const name = doc.name;
        if (emitted.has(name)) continue;

        if (ComponentFlags.Export === (doc.flags & ComponentFlags.Export)) {
            const component = docInfo.components[doc.name];
            if (!component) continue;
            const componentCode = generateComponentTypeDefinition(component, docInfo.interfaces);
            code += indentCode(componentCode, '    ');
            emitted.add(name);
        }
    }

    // Emit remaining exported functions
    for (let fname of Object.keys(docInfo.functions || {})) {
        if (emitted.has(fname)) continue;
        const fn = docInfo.functions[fname];
        if (!fn) continue;
        if (!isExplicitlyExported(fn.comment)) continue;

        const paramsTxt = fn.parameters.map(p => `${p.name}: ${p.type}`).join(', ');
        const ret = fn.return || 'void';
        const commentBlock = fn.comment ? '\n' + fn.comment + '\n' : '\n';
        const decl = `export function ${fname}(${paramsTxt}): ${ret};\n`;
        code += indentCode(commentBlock + decl, '    ');
        emitted.add(fname);
    }

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
    const docInfo: IDocInfo = { interfaces: {}, components: {}, hooks: {}, functions: {}, unions: {} };

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


