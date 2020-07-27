import * as tsdoc from '@microsoft/tsdoc';
import * as fs from 'fs';
import * as ts from 'typescript';


  interface IInterfaceMember {
    name: string;
    type: string;
    comment: string;
  }
  interface IInterfaceDeclaration {
    name: string;
    comment: string;
    members:IInterfaceMember[];
  }
  interface IReactComponent {
    name: string;
    propType: string;
    comment: string;
  }
  interface IDocInfo {
      interfaces:{[key:string]:IInterfaceDeclaration};
      components:{[key:string]:IReactComponent};
  }

function extractComment(node:ts.Node) {
  let fullText = node.getSourceFile().getFullText();
  let comments = ts.getLeadingCommentRanges(fullText,node.pos);
  if (!comments) return '';
  return comments!.map(c => fullText.slice(c.pos,c.end)).join('\n');
}
function parseInterfaceDeclaration(node:ts.Node,docInfo:IDocInfo) {
  let name = (node as any).name.getText();
  let members = (node as any).members;
  let docs = extractComment(node);
  let inf:IInterfaceDeclaration = {comment:docs, members:[],name:name};
  for(let i=0;i<members.length;i++) {
    let member = members[i];
    let name = member.name.getText();
    let type = member.type.getText();
    let mdoc = extractComment(member);
    inf.members.push({comment:mdoc,name:name,type:type});
  }
  docInfo.interfaces[name] = inf;

}
function parseVariableDeclaration(node:ts.Node,docInfo:IDocInfo) {

  let type = (node as any).type?.typeName?.getText();
  if (!type) {
      return;
  }
  if (type == 'React.FunctionComponent') {
    let name = (node as any).name.getText();
    let propType = (node as any).type.typeArguments[0].getText();
    let comment = extractComment(node.parent);
    docInfo.components[name] = {comment,propType,name};
  }
}
function parseClassDeclaration(node:ts.Node,docInfo:IDocInfo) {
  let className = (node as any)?.heritageClauses[0]?.types[0].expression.getText();
  if (className = 'React.Component') {
    let propType = (node as any).heritageClauses[0].types[0].typeArguments[0].getText();
    let comment = extractComment(node);
    let name = (node as any).name.getText();
    docInfo.components[name] = {comment,propType,name};

  }
}

function walkTree(node:ts.Node,docInfo:IDocInfo) {
  switch(node.kind) {
    case ts.SyntaxKind.InterfaceDeclaration:
      parseInterfaceDeclaration(node,docInfo);
      break;
    case ts.SyntaxKind.VariableDeclaration:
      parseVariableDeclaration(node,docInfo);
      break;
    case ts.SyntaxKind.ClassDeclaration:
      parseClassDeclaration(node,docInfo);
      break;

  }
  node.forEachChild(child => walkTree(child,docInfo));

}
function validateProgram(program:ts.Program) {
    const compilerDiagnostics: ReadonlyArray<ts.Diagnostic> = program.getSemanticDiagnostics();
    if (compilerDiagnostics.length > 0) {
      for (const diagnostic of compilerDiagnostics) {
  
        const message: string = ts.flattenDiagnosticMessageText(diagnostic.messageText,'\n');
        if (diagnostic.file) {
          const location: ts.LineAndCharacter = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start!);
          const formattedMessage: string = `${diagnostic.file.fileName}(${location.line + 1},${location.character + 1}):`
            + ` [TypeScript] ${message}`;
          console.log((formattedMessage));
        } else {
          console.log((message));
        }
      }
    } else {
      console.log('No compiler errors or warnings.');
    }
}

function getSources(program:ts.Program) {
    return program.getSourceFiles().filter(f => {
        return f.fileName.indexOf('node_modules')  < 0
    }).map(f => f.fileName);
}

function start(root:string) {
    let options:ts.CompilerOptions = {
        jsx:ts.JsxEmit.React,
    };
    console.log('Loading',root);
    let program = ts.createProgram([root],options);
    console.log('Compiled');
    validateProgram(program);
    console.log('Validated');
    let sources = getSources(program);
    let docInfo:IDocInfo = {interfaces:{},components:{}};
    for(var i=0;i<sources.length;i++) {
        let source = sources[i];
        console.log('Loading',source);
        let sourceNode = program.getSourceFile(source);
        if (!sourceNode) {
            continue;
        }

        try {
            walkTree(sourceNode,docInfo);
        } catch (error) {
            console.log(`Error in ${source}: ${error}`)
        }
    }
    console.log(docInfo);
    
}
function main() {
    let args = process.argv;
    start(args[2]);
}
main();

