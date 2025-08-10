import * as ts from 'typescript';
import { IDocInfo, ComponentFlags, IExportInfo } from '../core/types';
import { parseTSDocComment } from '../core/parser';

export function hasExportAnnotation(comment: string): boolean {
    try {
        const [, , flags] = parseTSDocComment(comment);
        return (flags & ComponentFlags.Export) === ComponentFlags.Export;
    } catch {
        return false;
    }
}

export function getExportInfo(node: ts.Node): IExportInfo {
    const sourceFile = node.getSourceFile();
    const exportInfo: IExportInfo = { isDefault: false, isNamed: false };

    if (node.modifiers) {
        const hasExport = node.modifiers.some(mod => mod.kind === ts.SyntaxKind.ExportKeyword);
        const hasDefault = node.modifiers.some(mod => mod.kind === ts.SyntaxKind.DefaultKeyword);
        if (hasExport && hasDefault) {
            exportInfo.isDefault = true;
        } else if (hasExport) {
            exportInfo.isNamed = true;
        }
    }

    sourceFile.forEachChild(child => {
        if (ts.isExportAssignment(child) && child.isExportEquals === false) {
            if (ts.isIdentifier(child.expression)) {
                const exportedName = child.expression.getText();
                const nodeName = (node as any).name?.getText();
                if (exportedName === nodeName) {
                    exportInfo.isDefault = true;
                }
            }
        }

        if (ts.isExportDeclaration(child) && child.exportClause && ts.isNamedExports(child.exportClause)) {
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

export function linkedType(type: string, docInfo: IDocInfo): string {
    const cleanType = type.replace(/\[\]$/, '');
    if (docInfo.interfaces[cleanType] || docInfo.unions[cleanType] ||
        docInfo.enums[cleanType] || docInfo.typeAliases?.[cleanType]) {
        return `[${type}](../types/${cleanType}.md)`;
    }
    return type;
}

export function getRelatedTypes(item: { propType?: string, refType?: string, stateType?: string, parameters?: any[], return?: string, type?: string }, dependentTypes: Set<string>, docInfo: IDocInfo): string[] {
    const relatedTypes: string[] = [];
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

    function collectRelatedTypes(typeName: string) {
        if (visited.has(typeName) || !dependentTypes.has(typeName)) return;
        visited.add(typeName);
        relatedTypes.push(typeName);

        if (docInfo.interfaces?.[typeName]) {
            const intf = docInfo.interfaces[typeName];
            const extendsMatch = intf.code.match(/extends\s+([^{]+)/);
            if (extendsMatch) {
                const extendedTypes = extractTypeNames(extendsMatch[1]);
                extendedTypes.forEach(t => collectRelatedTypes(t));
            }
            intf.members.forEach(member => {
                const memberTypes = extractTypeNames(member.type);
                memberTypes.forEach(t => collectRelatedTypes(t));
            });
        }

        if (docInfo.unions?.[typeName]) {
            const union = docInfo.unions[typeName];
            union.items.forEach(item => {
                const itemTypes = extractTypeNames(item);
                itemTypes.forEach(t => collectRelatedTypes(t));
            });
        }

        if (docInfo.typeAliases?.[typeName]) {
            const alias = docInfo.typeAliases[typeName];
            const aliasTypes = extractTypeNames(alias.type);
            aliasTypes.forEach(t => collectRelatedTypes(t));
        }

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

    if (item.propType) collectRelatedTypes(item.propType);
    if (item.refType) collectRelatedTypes(item.refType);
    if (item.stateType) collectRelatedTypes(item.stateType);
    if (item.parameters) {
        item.parameters.forEach(param => collectRelatedTypes(param.type));
    }
    if (item.return) collectRelatedTypes(item.return);
    if (item.type) collectRelatedTypes(item.type);

    return [...new Set(relatedTypes)];
}