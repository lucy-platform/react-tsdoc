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

function logCompilerMessage(message:string) {
    console.error(chalk.gray(`[TypeScript] ${message}`));
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
class MarkdownBuilder {
    private code = "";
    public addTitle(title:string,level:1|2|3|4) {
        let headerChar = '#';
        let prefix = '';
        for(let i=0;i<level;i++) {
            prefix += headerChar;
        }
        this.code += prefix +' ' + title+'\n\n';
    }
    public addParagraph(p:string) {
        
        this.code += '\n\n' + p + '\n\n';
    }

    public addCode(code:string) {
        code = code.trim();
        if (code.startsWith('```')) {
            code = code.substring(3);
        }
        if (code.endsWith('```')) {
            code = code.substring(0,code.length-3);
        }
        this.code += '\n\n```tsx\n' + code.trim() + '\n```\n\n'
    }
    public addTable(table:any[]) {
        const tableFormat = (s:string) => {
            return s.replace(/\s+/g,' ').replace(/\|/g,'\\|');
        }
        if (table.length==0) return;
        let headers = Object.keys(table[0]);
        this.code += '|' + (headers.map(tableFormat)).join('|') + '|\n';
        this.code += '|' + (headers.map(h=>'-')).join('|')+'|\n';
        for(let i in table) {
            let row = table[i];
            this.code += '|' + (headers.map(h => tableFormat(row[h]))).join('|') + '|\n';
        }
    
    }
    public toString() {
        return this.code;
    }
}
interface IExportModuleOptions {
    moduleName: string;
}

interface ITypeDefinition {
    comment:string;
}

interface IFunctionParam {
    name: string;
    type: string;
}
interface IFunctionSignature extends ITypeDefinition {
    parameters:IFunctionParam[];
    return:string;
    code: string;
}
interface IUnion extends ITypeDefinition{
    items:string[];
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
    comment: string;
}
interface IReactHookParam {
    name: string;
    type: string;
}
interface IReactHook {
    name: string;
    type:string;
    parameters:IReactHookParam[];
    comment:string;
}
interface IDocInfo {
    interfaces: { [key: string]: IInterfaceDeclaration };
    components: { [key: string]: IReactComponent };
    hooks: { [key: string]: IReactHook };
    functions:{[key:string]:IFunctionSignature};
    unions:{[key:string]:IUnion};

}
interface IExample {
    summary: string;
    
}
interface ITypeDocumentation {
    name: string;
    type: 'interface' | 'function' |'union';
    summary: string;
    examples:IExample[];
    code:string;
    flags:ComponentFlags;

}

interface IHookDocumentation {
    name: string;
    summary: string;
    examples:IExample[];
    flags:ComponentFlags;
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
interface IDocObject {
    components:IComponentDocumentation[];
    hooks:IHookDocumentation[];
    types:ITypeDocumentation[];
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
function generateHookTypeDefinition(hook:IReactHook) {
    return `export const ${hook.name}:${hook.type};`;
}
function generateComponentTypeDefinition(c:IReactComponent,interfaces:{[key:string]:IInterfaceDeclaration}) {
    let code = "";
    let inf = interfaces[c.propType];
    if (inf) {
        code += inf.comment + '\n';
        code += inf.code + '\n';
    }
    code += c.comment + '\n';
    code += `export const ${c.name} : React.FunctionComponent<${c.propType}>;\n`
    return code;
}
function fillRelatedTypes(t:string,types:any,docInfo:IDocInfo) {
    if (docInfo.interfaces[t]) {
        types[t] = 1;
        let inf = docInfo.interfaces[t];
        for(let m of inf.members) {
            fillRelatedTypes(m.comment,types,docInfo);
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
        fillRelatedTypes(f.return,types,docInfo);
        for(let p of f.parameters) {
            let pt = p.type;
            fillRelatedTypes(pt,types,docInfo);
        }
    }

}
function generateDocObject(docInfo: IDocInfo): IDocObject {
    let components: IComponentDocumentation[] = [];
    //let typesToExport:any = {};
    for (let cn in docInfo.components) {
        let componentDoc: IComponentDocumentation = { examples: [], name: cn, props: [], summary: '' ,flags:ComponentFlags.None};
        let componentInfo = docInfo.components[cn];
        [componentDoc.summary,componentDoc.examples,componentDoc.flags] = parseTSDocComment(componentInfo.comment);

        let propType = docInfo.interfaces[componentInfo.propType];
        if (!!propType) {
            componentDoc.props = generatePropDocs(propType)
        }
        //typesToExport[componentInfo.propType] = 1;

        components.push(componentDoc);

    }
    let hooks:IHookDocumentation[] = [];
    for(let hi in docInfo.hooks) {
        let hook = docInfo.hooks[hi];
        let hookDoc:IHookDocumentation = {name:hook.name,flags:ComponentFlags.None,summary:'',examples:[]};
        [hookDoc.summary,hookDoc.examples,hookDoc.flags] = parseTSDocComment(hook.comment);
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
    let types:ITypeDocumentation[] = [];
    for(let k of Object.keys(docInfo.interfaces)) {
        let inf = docInfo.interfaces[k];
        let typeDoc:ITypeDocumentation = { examples:[],name:inf.name,summary:'',type:'interface',code:'',flags:ComponentFlags.None};
        typeDoc.code = inf.code;
        [typeDoc.summary,typeDoc.examples,typeDoc.flags] = parseTSDocComment(inf.comment);
        types.push(typeDoc);
    }
    for(let k of Object.keys(docInfo.functions)) {
        let inf = docInfo.functions[k];
        let typeDoc:ITypeDocumentation = { examples:[],name:k,summary:'',type:'function',code:'',flags:ComponentFlags.None};
        typeDoc.code = inf.code;
        [typeDoc.summary,typeDoc.examples,typeDoc.flags] = parseTSDocComment(inf.comment);
        types.push(typeDoc);
    }
    for(let k of Object.keys(docInfo.unions)) {
        let inf = docInfo.unions[k];
        let typeDoc:ITypeDocumentation = { examples:[],name:k,summary:'',type:'union',code:'',flags:ComponentFlags.None};
        typeDoc.code = inf.code;
        [typeDoc.summary,typeDoc.examples,typeDoc.flags] = parseTSDocComment(inf.comment);
        types.push(typeDoc);
    }
    

    return {components,hooks,types};
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
    if ((node as any)?.type?.kind == ts.SyntaxKind.CallSignature || 
        (node as any)?.type?.kind == ts.SyntaxKind.FunctionType
        )
        {
            console.log('dug');
        }
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
        let parameters:IReactHookParam[] = [];

        docInfo.hooks[name] = {name,type,parameters,comment};
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
    if (type.kind == ts.SyntaxKind.FunctionType) {
        let returnType = type.getText();
        let parameters = type.parameters;
        let comment = extractComment(node);
        let code = getCode(node);
        let f:IFunctionSignature = {parameters:[],return:returnType,comment,code};
        for(let p=0;p<parameters.length;p++) {
            let parameter = parameters[p];
            let fp:IFunctionParam = {name:parameter.name.getText(),type:parameter.type.getText()};
            f.parameters.push(fp);

        }
        docInfo.functions[name] = f;
        return;
    }
    if (type.kind == ts.SyntaxKind.UnionType) {
        let types = type.types;
        let comment = extractComment(node);
        let code = getCode(node);
        let u:IUnion = {items:[],comment,code};

        for(let p=0;p<types.length;p++) {
            let txt = types[p].getText();
            u.items.push(txt);
        }
        docInfo.unions[name] = u;
    }
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

function generateExportModule(docs:IDocObject,docInfo:IDocInfo,options:IExportModuleOptions) {
    let code = '';
    if (options?.moduleName) {
        code += `declare module "${options.moduleName}" {\n`;
    }
    for(let i in docs.types) {
        let obj = docs.types[i];
        let comment = '';
        if (docInfo.interfaces[obj.name]) {
            comment = docInfo.interfaces[obj.name].comment;
        }
        if (docInfo.functions[obj.name]) {
            comment = docInfo.functions[obj.name].comment;
        }
        if (docInfo.unions[obj.name]) {
            comment = docInfo.unions[obj.name].comment;
        }
        if (ComponentFlags.Export === (obj.flags & ComponentFlags.Export)) {
            code += indentCode('\n' + comment + '\n' +  'export ' + obj.code+'\n','    ');
        }
    }
    for(let i in docs.components) {
        let doc = docs.components[i];
        if (ComponentFlags.Export === (doc.flags & ComponentFlags.Export)) {
            let component = docInfo.components[doc.name];
            let componentCode = generateComponentTypeDefinition(component,docInfo.interfaces);
            code += indentCode(componentCode,'    ');
        }
    }
    for(let i in docs.hooks) {
        let doc = docs.hooks[i];
        if (ComponentFlags.Export === (doc.flags & ComponentFlags.Export)) {
            let hook = docInfo.hooks[doc.name];
            let hookCode = generateHookTypeDefinition(hook);
            code += indentCode(hookCode,'    ');
        }

    }
    code += "\n}\n";
    return code;
}

function load(root: string):[IDocInfo,IDocObject] {
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
    let docInfo: IDocInfo = { interfaces: {}, components: {},hooks:{},functions:{},unions:{} };
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
    return [docInfo,docs];
   
    
    
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


function generateHookDoc(cdoc:IHookDocumentation,docs:IDocObject) {
    let md =new MarkdownBuilder();
    md.addTitle(cdoc.name,1)
    md.addParagraph(cdoc.summary);
    md.addTitle('Installation',2);
    md.addCode(`import {${cdoc.name}} from 'uxp/components';`);
    if (cdoc.examples.length > 0) {
        md.addTitle('Examples',2);
        for(let i in cdoc.examples) {
            md.addCode(cdoc.examples[i].summary)
        }
    }
    
    return md.toString();
}

function generateTypeDoc(cdoc:ITypeDocumentation,docs:IDocObject) {
    let md =new MarkdownBuilder();
    md.addTitle(cdoc.name,1)
    md.addParagraph(cdoc.summary);
    md.addCode(cdoc.code);
    md.addTitle('Usage',2);
    md.addCode(`import {${cdoc.name}} from 'uxp/components';`);
    if (cdoc.examples.length > 0) {
        md.addTitle('Examples',2);
        for(let i in cdoc.examples) {
            md.addCode(cdoc.examples[i].summary)
        }
    }
    
    
    return md.toString();
}
function linkedType(t: string, docs:IDocObject) {
    if (docs.types.find(x => x.name.toUpperCase() == t.toUpperCase())) {
        return `[${t}](types/${t})`;
    }
    return t;
}
function generateComponentDoc(cdoc:IComponentDocumentation,docs:IDocObject) {
    let md =new MarkdownBuilder();
    md.addTitle(cdoc.name,1)
    md.addParagraph(cdoc.summary);
    md.addTitle('Installation',2);
    md.addCode(`import {${cdoc.name}} from 'uxp/components';`);
    if (cdoc.examples.length > 0) {
        md.addTitle('Examples',2);
        for(let i in cdoc.examples) {
            md.addCode(cdoc.examples[i].summary)
        }
    }
    if (cdoc.props.length > 0) {

        md.addTitle('Properties',2);
        md.addTable(cdoc.props.map(p => ({Name:p.name,Type:linkedType(p.type,docs),Description:p.summary})));
        for(let i in cdoc.props) {
            let prop = cdoc.props[i];
            md.addTitle(prop.name,3);
            md.addParagraph('---');
            md.addParagraph(prop.summary);
            md.addTable([{'type':linkedType(prop.type,docs)}]);
            
            for(let j in prop.examples) {
                md.addCode(prop.examples[j].summary);
            }
        }
        
    }
    return md.toString();
}
function generateDocs(root: string, outputPath:string) {
    let [docInfo,docs] = load(root);
    let components = docs.components;
    if (outputPath.endsWith('/')) outputPath = outputPath.substring(0,outputPath.length-1);

    mkdirp.sync(outputPath + '/components/');
    mkdirp.sync(outputPath + '/types/');
    mkdirp.sync(outputPath + '/hooks/');

    for(let i in components) {
        let component = components[i];
        if (ComponentFlags.Export === (component.flags & ComponentFlags.Export)) {
            let md = generateComponentDoc(component,docs);
            let path = outputPath + '/components/' + component.name + '.md';

            console.log(chalk.gray('Writing component',component.name,'to',path));
            fs.writeFileSync(path,md.toString());
        }
    }
    for(let i in docs.types) {
        let type = docs.types[i];
        if (ComponentFlags.Export === (type.flags & ComponentFlags.Export)) {
            let md = generateTypeDoc(type,docs);
            let path = outputPath + '/types/' + type.name + '.md';
            console.log(chalk.gray('Writing type',type.name,'to',path));
            fs.writeFileSync(path,md.toString());
        }
    }

    for(let i in docs.hooks) {
        let hook = docs.hooks[i];
        if (ComponentFlags.Export === (hook.flags & ComponentFlags.Export)) {
            let md = generateHookDoc(hook,docs);
            let path = outputPath + '/hooks/' + hook.name + '.md';
            console.log(chalk.gray('Writing hook',hook.name,'to',path));
            fs.writeFileSync(path,md.toString());
        }
    }
}
function generateTypeDefinition(root:string,outputPath:string,moduleName:string) {
    

    let [docInfo,docs] = load(root);
    let moduleCode = generateExportModule(docs,docInfo,{moduleName:moduleName || 'module'});
    fs.writeFileSync(outputPath,moduleCode);
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

        
        .action((actionArgs:{args:string[],options:any})=>{
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
        .action((actionArgs:{args:string[],options:any})=>{
            let {args,options} = actionArgs;
            generateDocs(args[0],args[1]);
        })
        ;
      
        cmd.run();
    } catch(e) {
        console.error(chalk.red(e));

    }
   

}


