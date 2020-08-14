import * as tsdoc from '@microsoft/tsdoc';
import * as fs from 'fs';
import * as ts from 'typescript';
import chalk from 'chalk';
import { DocNode } from '@microsoft/tsdoc';
enum ComponentFlags {
    None = 0,
    Export = 1 << 0,
    Hook = 1 << 1,
}

function logCompilerMessage(message:string) {
    console.log(chalk.gray(`[TypeScript] ${message}`));
}
function logDebug(...objects:any[]) {
    console.log(chalk.gray(...objects));
}
function logInfo(...objects:any[]) {
    console.log(chalk.green(...objects));
}
function logWarning(...objects:any[]) {
    console.log(chalk.redBright(...objects));
}
function logError(...objects:any[]) {
    console.log(chalk.redBright(...objects));
}
function indentCode(code:string,chars:string) {
    let lines = code.split('\n').map(line => line.trimRight());
    return lines.map(line => chars + line).join('\n');
}
interface IExportModuleOptions {
    moduleName: string;
}
type IType = IInterfaceDeclaration | ITypeLiteral | IFunctionSignature;
interface ITypeAlias {
    name: string;
    type: IType;
}
interface ITypeLiteral {
    name: string;
}

interface IFunctionParam {
    name: string;
    type: IType;
}
interface IFunctionSignature {
    parameters:IFunctionParam[];
    return:IType;
}
interface IInterfaceMember {
    name: string;
    type: string;
    comment: string;
}
interface IInterfaceDeclaration {
    name: string;
    comment: string;
    members: IInterfaceMember[];
    code: string;
}
interface IReactComponent {
    name: string;
    propType: string;
    comment: string;
}

interface IReactHook {
    name: string;
    code: string;
}
interface IDocInfo {
    interfaces: { [key: string]: IInterfaceDeclaration };
    components: { [key: string]: IReactComponent };
    hooks: { [key: string]: IReactHook };
}
interface IExample {
    summary: string;
    
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
    flags:ComponentFlags;

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
function extractActualContentFromDocMess(node:tsdoc.DocNode):string {
    if (!node) {
        return "";
    }
    let result = "";
    if (node instanceof tsdoc.DocExcerpt) {
        result += node.content.toString();
    }
    for(const childNode of node.getChildNodes()) {
        result += extractActualContentFromDocMess(childNode);
    }
    return result;
}
function parseTSDocComment(comment: string): [string, IExample[],ComponentFlags] {
    let config = new tsdoc.TSDocConfiguration();

    config.addTagDefinition(
        new tsdoc.TSDocTagDefinition({
            tagName:'@export',
            syntaxKind:tsdoc.TSDocTagSyntaxKind.ModifierTag,
            allowMultiple:false
        } )
    );

    config.addTagDefinition(
        new tsdoc.TSDocTagDefinition({
            tagName:'@hook',
            syntaxKind:tsdoc.TSDocTagSyntaxKind.ModifierTag,
            allowMultiple:false
        } )
    );

    let parser = new tsdoc.TSDocParser(config);

    let ctx = parser.parseString(comment);
    let summary = extractActualContentFromDocMess(ctx.docComment.summarySection);
    let examples:IExample[] = [];
    let props:ComponentFlags = ComponentFlags.None;
    for(const block of ctx.docComment.customBlocks) {
        if (block.blockTag.tagName == '@example') {
            let example = {summary:extractActualContentFromDocMess(block.content)};
            examples.push(example);

        }
    }
    let flags:ComponentFlags =  ComponentFlags.None;

    if (ctx.docComment.modifierTagSet.hasTagName('@export')) {
        flags = flags | ComponentFlags.Export;
    } 

    if (ctx.docComment.modifierTagSet.hasTagName('@hook')) {
        flags = flags | ComponentFlags.Hook;
    }

    return [summary,examples,flags];
}
function generatePropDocs(inf: IInterfaceDeclaration) {
    let results: IComponentPropDocumentation[] = [];
    for (let i in inf.members) {
        let prop = inf.members[i];
        let propDoc: IComponentPropDocumentation = { examples: [], name: prop.name, summary: '', type: prop.type };
        [propDoc.summary,propDoc.examples] = parseTSDocComment(prop.comment);
        results.push(propDoc);
    }
    return results;
}
function generateComponentTypeDefinition(c:IReactComponent,interfaces:{[key:string]:IInterfaceDeclaration}) {
    let code = "";
    let inf = interfaces[c.propType];
    if (inf) {
        code += inf.comment + '\n';
        code += inf.code + '\n';
    }
    code += c.comment + '\n';
    code += `export const ${c.name} : React.FunctionalComponent<${c.propType}>;\n`
    return code;
}
function generateDocObject(docInfo: IDocInfo): IComponentDocumentation[] {
    let results: IComponentDocumentation[] = [];
    for (let cn in docInfo.components) {
        let componentDoc: IComponentDocumentation = { examples: [], name: cn, props: [], summary: '' ,flags:ComponentFlags.None};
        let componentInfo = docInfo.components[cn];
        [componentDoc.summary,componentDoc.examples,componentDoc.flags] = parseTSDocComment(componentInfo.comment);

        let propType = docInfo.interfaces[componentInfo.propType];
        if (!!propType) {
            componentDoc.props = generatePropDocs(propType)
        }

        results.push(componentDoc);

    }
    return results;
}

function extractComment(node: ts.Node) {
    let fullText = node.getSourceFile().getFullText();
    let comments = ts.getLeadingCommentRanges(fullText, node.pos);
    if (!comments) return '';
    return comments!.map(c => fullText.slice(c.pos, c.end)).join('\n');
}
function getCode(node:ts.Node) {
    return node.getSourceFile().getFullText().substring(node.getStart(),node.getEnd());
}
function parseFunctionSignature(node:ts.Node,docInfo:IDocInfo) {

}
function parseInterfaceDeclaration(node: ts.Node, docInfo: IDocInfo) {

    let name = (node as any).name.getText();
    let members = (node as any).members;
    if (members.length==1 && members[0].kind == ts.SyntaxKind.CallSignature) {
        return parseFunctionSignature(members[0],docInfo);
    }

    let docs = extractComment(node);
    let inf: IInterfaceDeclaration = { comment: docs, members: [], name: name ,code:getCode(node)};
    for (let i = 0; i < members.length; i++) {
        let member = members[i];
        let name = member.name.getText();
        let type = member.type.getText();
        let mdoc = extractComment(member);
        inf.members.push({ comment: mdoc, name: name, type: type });
    }
    docInfo.interfaces[name] = inf;

}
function parseVariableDeclaration(node: ts.Node, docInfo: IDocInfo) {

    let type = (node as any).type?.typeName?.getText();
    if (type.kind == ts.SyntaxKind.CallSignature || 
        type.kind == ts.SyntaxKind.FunctionType
        )
    if (!type) {
        return;
    }
    let name = (node as any).name.getText() as string;
    if (type == 'React.FunctionComponent') {
        let propType = (node as any).type.typeArguments[0].getText();
        let comment = extractComment(node.parent);
        docInfo.components[name] = { comment, propType, name };
        return;
    }
    if (name.startsWith('use')) {
        let comment = extractComment(node.parent);
    }
}
function parseClassDeclaration(node: ts.Node, docInfo: IDocInfo) {
    let className = (node as any)?.heritageClauses[0]?.types[0].expression.getText();
    if (className = 'React.Component') {
        let propType = (node as any).heritageClauses[0].types[0].typeArguments[0].getText();
        let comment = extractComment(node);
        let name = (node as any).name.getText();
        docInfo.components[name] = { comment, propType, name };

    }
}
function parseTypeAlias(node:ts.Node,docInfo:IDocInfo) {
    let name = (node as any).name.getText();
    let type = (node as any).type;
}

function walkTree(node: ts.Node, docInfo: IDocInfo) {
    switch (node.kind) {
        case ts.SyntaxKind.TypeAliasDeclaration:
            parseTypeAlias(node,docInfo);
            break;
        case ts.SyntaxKind.InterfaceDeclaration:
            parseInterfaceDeclaration(node, docInfo);
            break;
        case ts.SyntaxKind.VariableDeclaration:
            parseVariableDeclaration(node, docInfo);
            break;
        case ts.SyntaxKind.ClassDeclaration:
            parseClassDeclaration(node, docInfo);
            break;
        case ts.SyntaxKind.FunctionDeclaration:
            parseVariableDeclaration(node,docInfo);
            break;

        

    }
    node.forEachChild(child => walkTree(child, docInfo));

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

function generateExportModule(docs:IComponentDocumentation[],docInfo:IDocInfo,options:IExportModuleOptions) {
    let code = '';
    if (options?.moduleName) {
        code += `declare module "${options.moduleName}" {\n`;
    }
    for(let i in docs) {
        let doc = docs[i];
        if (ComponentFlags.Export === (doc.flags & ComponentFlags.Export)) {
            let component = docInfo.components[doc.name];
            let componentCode = generateComponentTypeDefinition(component,docInfo.interfaces);
            code += indentCode(componentCode,'    ');
        }
    }
    code += "\n}\n";
    return code;
}

function start(root: string) {
    let options: ts.CompilerOptions = {
        jsx: ts.JsxEmit.React,
    };
    logDebug('Loading',root);
    logDebug('Loading', root);
    let program = ts.createProgram([root], options);
    logDebug('Compiled');
    validateProgram(program);
    logDebug('Validated');
    let sources = getSources(program);
    let docInfo: IDocInfo = { interfaces: {}, components: {},hooks:{} };
    for (var i = 0; i < sources.length; i++) {
        let source = sources[i];
        logDebug('Loading', source);
        let sourceNode = program.getSourceFile(source);
        if (!sourceNode) {
            continue;
        }

        try {
            walkTree(sourceNode, docInfo);
        } catch (error) {
            logError(`Error in ${source}: ${error}`)
        }
    }
    let docs = generateDocObject(docInfo);
    let moduleCode = generateExportModule(docs,docInfo,{moduleName:'uxp/components'});
    console.log(moduleCode);
    
    
/*
    for(let i in docInfo.components) {
        let c = docInfo.components[i];
        let inf = docInfo.interfaces[c.propType];
        if (!!inf) {
            console.log(inf.comment);
            console.log(inf.code);
        }
        console.log(c.comment);
        console.log(`export const ${c.name} : React.FunctionComponent<${c.propType}>;`)
    }*/

}


function main() {
    let args = process.argv;
    let rootFile = args[2];
    start(rootFile);
}
main();

