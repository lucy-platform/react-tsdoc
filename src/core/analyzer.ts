import * as ts from 'typescript';
import { IDocInfo, IReactComponent, IFunctionParam, IReactHookParam, IInterfaceDeclaration } from './types';
import { logCompilerMessage, logDebug, logWarning } from '../utils/logger';

export function extractComment(node: ts.Node): string {
    try {
        if (!node || !node.getSourceFile) return '';
        const fullText = node.getSourceFile().getFullText();
        const comments = ts.getLeadingCommentRanges(fullText, node.pos);
        return comments ? comments.map(c => fullText.slice(c.pos, c.end)).join('\n') : '';
    } catch (error) {
        console.warn('Error extracting comment:', error);
        return '';
    }
}

export function getCode(node: ts.Node): string {
    return node.getSourceFile().getFullText().substring(node.getStart(), node.getEnd());
}

export function unwrapCallWrappers(expr: ts.Expression): { inner: ts.Expression, wrappers: string[] } {
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

export function analyzeComponentPattern(
    init: ts.Expression,
    name: string,
    comment: string,
    checker: ts.TypeChecker,
    docInfo: IDocInfo,
    declaredType?: ts.TypeNode
): IReactComponent | null {
    const { inner, wrappers } = unwrapCallWrappers(init);
    const parsedWrappers = wrappers.filter(w => /\b(React\.)?(memo|forwardRef)$/.test(w));

    function parseTypeText(typeText: string): { type?: 'class' | 'functional' | 'forwardRef', propType?: string, refType?: string, stateType?: string, innerWrappers?: string[] } | null {
        if (/\b(React\.)?MemoExoticComponent\b/.test(typeText)) {
            const innerMatch = typeText.match(/<([^>]+)>/);
            if (!innerMatch) return null;
            const innerType = innerMatch[1].trim();
            const innerParsed = parseTypeText(innerType);
            if (innerParsed) {
                return { ...innerParsed, innerWrappers: [...(innerParsed.innerWrappers || []), 'memo'] };
            }
            const propMatch = innerType.match(/React\.FunctionComponent<({[^}]*}|[^>]+)>/) || innerType.match(/React\.FC<({[^}]*}|[^>]+)>/);
            return {
                type: 'functional',
                propType: propMatch ? propMatch[1].trim() : 'any',
                innerWrappers: ['memo']
            };
        }

        if (/\b(React\.)?ForwardRefExoticComponent\b/.test(typeText)) {
            const frMatch = typeText.match(/<React\.RefAttributes<([^>]+)>\s*&\s*({[^}]*}|[^>]+)>/);
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
            const propMatch = typeText.match(/<\s*({[^}]*}|[^>]+)>/);
            return {
                type: 'functional',
                propType: propMatch ? propMatch[1].trim() : 'any'
            };
        }

        if (/\b(React\.)?Component\b/.test(typeText)) {
            const compMatch = typeText.match(/<({[^}]*}|[^,]+)(?:,\s*({[^}]*}|[^>]+))?>/);
            return {
                type: 'class',
                propType: compMatch ? compMatch[1].trim() : 'any',
                stateType: compMatch && compMatch[2] ? compMatch[2].trim() : 'any'
            };
        }

        return null;
    }

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
            const referencedName = inner.getText();
            referencedComponent = referencedName;
            const symbol = checker.getSymbolAtLocation(inner);
            if (symbol && symbol.declarations) {
                const decl = symbol.declarations[0];
                if (ts.isVariableDeclaration(decl) && decl.type) {
                    const typeText = decl.type.getText();
                    const propMatch = typeText.match(/React\.FunctionComponent<({[^}]*}|[^>]+)>/) || typeText.match(/React\.FC<({[^}]*}|[^>]+)>/);
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

export function parseInterfaceDeclaration(node: ts.Node, docInfo: IDocInfo) {
    if (!ts.isInterfaceDeclaration(node)) return;

    const name = (node as any).name.getText();
    const members = (node as any).members;
    const docs = extractComment(node);
    const inf: IInterfaceDeclaration = { comment: docs, members: [], name, code: getCode(node) };

    for (const member of members) {
        const memberName = member?.name?.getText?.();
        if (!memberName) continue;
        const memberType = member?.type?.getText?.() || 'undefined';

        const mdoc = extractComment(member);
        const isOptional = member.questionToken !== undefined;

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

export function parseVariableDeclaration(node: ts.Node, docInfo: IDocInfo, checker: ts.TypeChecker) {
    if (!ts.isVariableDeclaration(node)) return;

    const decl = node as ts.VariableDeclaration;
    const name = decl.name?.getText?.();
    if (!name) return; // Add safety check

    const parentForComments = (decl.parent && decl.parent.parent) ? decl.parent.parent : node.parent;
    const comment = extractComment(parentForComments || node) || '';
    const init = decl.initializer;
    const declaredType = decl.type as ts.TypeNode | undefined;

    if (name.startsWith('use')) {
        const parameters: IReactHookParam[] = [];
        let hookReturnType = 'void';

        if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) {
            if (init.parameters) {
                for (const param of init.parameters) {
                    const pname = param.name?.getText() || 'arg';
                    const ptype = param.type ? param.type.getText() : 'any';
                    parameters.push({ name: pname, type: ptype });
                }
            }

            // Handle async functions
            if (init.modifiers?.some(m => m.kind === ts.SyntaxKind.AsyncKeyword)) {
                logDebug(`Found async hook: ${name}`);
                // Adjust return type inference for async functions
                hookReturnType = 'Promise<any>';
            } else if (init.type) {
                hookReturnType = init.type.getText();
            } else if (checker) {
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
        return;
    }

    if (init) {
        const componentInfo = analyzeComponentPattern(init, name, comment, checker, docInfo, declaredType);
        if (componentInfo) {
            docInfo.components[name] = componentInfo;
            return;
        }
    }

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

export function parseClassDeclaration(node: ts.Node, docInfo: IDocInfo, checker?: ts.TypeChecker) {
    if (!ts.isClassDeclaration(node)) return;

    const name = node.name?.getText();
    if (!name) return;

    const comment = extractComment(node);
    const heritage = node.heritageClauses && node.heritageClauses.length > 0 ? node.heritageClauses[0] : undefined;
    if (!heritage || !heritage.types || heritage.types.length === 0) return;

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

export function parseFunctionDeclaration(node: ts.Node, docInfo: IDocInfo, checker?: ts.TypeChecker) {
    if (!ts.isFunctionDeclaration(node)) return;

    const name = node.name?.getText();
    if (!name) return;

    const comment = extractComment(node) || '';
    if (name.startsWith('use')) {
        const parameters: IReactHookParam[] = [];
        let hookReturnType = 'void';

        if (node.parameters) {
            for (const p of node.parameters) {
                const pname = p.name?.getText?.() ?? 'arg';
                let ptype = p.type ? p.type.getText() : 'any';
                parameters.push({ name: pname, type: ptype });
            }
        }

        if (node.type) {
            hookReturnType = node.type.getText();
        } else if (checker) {
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
        return;
    }

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

export function parseEnumDeclaration(node: ts.Node, docInfo: IDocInfo) {
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

export function parseTypeAlias(node: ts.Node, docInfo: IDocInfo) {
    if (!ts.isTypeAliasDeclaration(node)) return;

    const name = node.name.getText();
    const type = node.type;
    const comment = extractComment(node);
    const code = getCode(node);

    if (type.kind === ts.SyntaxKind.FunctionType) {
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
        const unionType = type as ts.UnionTypeNode;
        const items: string[] = [];

        for (const unionMember of unionType.types) {
            items.push(unionMember.getText());
        }

        docInfo.unions[name] = { items, comment, code };
        return;
    }

    docInfo.typeAliases[name] = {
        name,
        type: type.getText(),
        comment,
        code
    };
}

export function walkTree(node: ts.Node, docInfo: IDocInfo, checker: ts.TypeChecker) {
    if (!node || !node.getSourceFile()) return;

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

        // Add handling for common nodes that don't need processing
        case ts.SyntaxKind.SourceFile:
        case ts.SyntaxKind.ImportDeclaration:
        case ts.SyntaxKind.ImportClause:
        case ts.SyntaxKind.NamedImports:
        case ts.SyntaxKind.ImportSpecifier:
        case ts.SyntaxKind.Identifier:
        case ts.SyntaxKind.StringLiteral:
        case ts.SyntaxKind.NumericLiteral:
        case ts.SyntaxKind.ExportKeyword:
        case ts.SyntaxKind.ExportDeclaration:
        case ts.SyntaxKind.DefaultKeyword:
        case ts.SyntaxKind.AsExpression:
        case ts.SyntaxKind.AwaitExpression:
        case ts.SyntaxKind.CallExpression:
        case ts.SyntaxKind.ElementAccessExpression:
        case ts.SyntaxKind.PropertyAccessExpression:
            // These are common nodes that don't need special processing
            // Just continue traversing their children
            break;

        default:
            // Only log truly unknown/unexpected nodes
            if (node.kind > ts.SyntaxKind.LastToken && process.env.VERBOSE_DEBUG) {
                logDebug(`Unhandled node kind: ${ts.SyntaxKind[node.kind]} at ${node.getSourceFile()?.fileName}:${node.pos}`);
            }
    }

    // Add error handling for child traversal
    try {
        node.forEachChild(child => {
            if (child) {
                walkTree(child, docInfo, checker);
            }
        });
    } catch (error) {
        logWarning(`Error traversing children of ${ts.SyntaxKind[node.kind]}:`, error);
    }
}

export function validateProgram(program: ts.Program) {
    const compilerDiagnostics = program.getSemanticDiagnostics();
    if (compilerDiagnostics.length > 0) {
        for (const diagnostic of compilerDiagnostics) {
            const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
            if (diagnostic.file) {
                const location = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start!);
                logCompilerMessage(`${diagnostic.file.fileName}(${location.line + 1},${location.character + 1}): ${message}`);
            } else {
                logCompilerMessage(message);
            }
        }
    } else {
        logCompilerMessage('No compiler errors or warnings.');
    }
}

export function getSources(program: ts.Program) {
    return program.getSourceFiles()
        .filter(f => f.fileName.indexOf('node_modules') < 0)
        .map(f => f.fileName);
}