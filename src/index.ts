import * as tsdoc from '@microsoft/tsdoc';
import * as fs from 'fs';
import * as ts from 'typescript';
import chalk from 'chalk';
import { DocNode } from '@microsoft/tsdoc';
enum ComponentFlags {
    None = 0,
    Export = 1 << 0,
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
interface IDocInfo {
    interfaces: { [key: string]: IInterfaceDeclaration };
    components: { [key: string]: IReactComponent };
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
    let flags:ComponentFlags = ctx.docComment.modifierTagSet.hasTagName('@export') ? ComponentFlags.Export : ComponentFlags.None;
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
function parseInterfaceDeclaration(node: ts.Node, docInfo: IDocInfo) {
    let name = (node as any).name.getText();
    let members = (node as any).members;
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
    if (!type) {
        return;
    }
    if (type == 'React.FunctionComponent') {
        let name = (node as any).name.getText();
        let propType = (node as any).type.typeArguments[0].getText();
        let comment = extractComment(node.parent);
        docInfo.components[name] = { comment, propType, name };
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

function walkTree(node: ts.Node, docInfo: IDocInfo) {
    switch (node.kind) {
        case ts.SyntaxKind.InterfaceDeclaration:
            parseInterfaceDeclaration(node, docInfo);
            break;
        case ts.SyntaxKind.VariableDeclaration:
            parseVariableDeclaration(node, docInfo);
            break;
        case ts.SyntaxKind.ClassDeclaration:
            parseClassDeclaration(node, docInfo);
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
    let docInfo: IDocInfo = { interfaces: {}, components: {} };
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
    
    for(let i in docs) {
        let doc = docs[i];
        if (ComponentFlags.Export === (doc.flags & ComponentFlags.Export)) {
            let component = docInfo.components[doc.name];
            let code = generateComponentTypeDefinition(component,docInfo.interfaces);
            console.log(code);
        }
    }
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

