import { IDocInfo } from '../../core/types';
import { MarkdownBuilder } from '../markdown';
import { parseTSDocComment } from '../../core/parser';
import { getRelatedTypes } from '../../utils/type-helpers';

export function generateTypeDocFromDocInfo(typeInfo: any, typeKind: 'interface' | 'union' | 'enum' | 'type', docInfo: IDocInfo, moduleName?: string, dependentTypes?: Set<string>) {
    const md = new MarkdownBuilder();
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
        for (const example of examples) {
            md.addCode(example.summary);
        }
    }

    // if (dependentTypes) {
    //     const relatedTypes: string[] = [];

    //     if (typeKind === 'interface' && typeInfo.members) {
    //         typeInfo.members.forEach((member: any) => {
    //             if (member.type && dependentTypes.has(member.type)) {
    //                 relatedTypes.push(member.type);
    //             }
    //         });
    //     }

    //     if (typeKind === 'union' && typeInfo.items) {
    //         typeInfo.items.forEach((item: string) => {
    //             if (dependentTypes.has(item)) {
    //                 relatedTypes.push(item);
    //             }
    //         });
    //     }

    //     const uniqueRelatedTypes = [...new Set(relatedTypes)];
    //     if (uniqueRelatedTypes.length > 0) {
    //         md.addTitle('Related Types', 2);
    //         const typeLinks = uniqueRelatedTypes.map(typeName => `- [${typeName}](../types/${typeName}.md)`).join('\n');
    //         md.addParagraph(typeLinks);
    //     }
    // }
    if (dependentTypes) {
        // Prepare a shape that getRelatedTypes can consume
        const typeSearchTarget: any = { type: typeInfo.name };

        if (typeKind === 'interface' && typeInfo.members) {
            // Collect member property types
            typeSearchTarget.propType = typeInfo.name;
            typeSearchTarget.parameters = typeInfo.members.map((m: any) => ({ type: m.type }));
            // Check for extends clause
            const extendsMatch = typeInfo.code.match(/extends\s+([^{]+)/);
            if (extendsMatch) {
                typeSearchTarget.type = extendsMatch[1];
            }
        }

        if (typeKind === 'union' && typeInfo.items) {
            typeSearchTarget.type = typeInfo.items.join(' | ');
        }

        if (typeKind === 'type' && typeInfo.type) {
            typeSearchTarget.type = typeInfo.type;
        }

        if (typeKind === 'enum') {
            // Enum members generally won't have related types,
            // but still pass the name so it can link if referenced elsewhere.
            typeSearchTarget.type = typeInfo.name;
        }

        const relatedTypes = getRelatedTypes(typeSearchTarget, dependentTypes, docInfo)
            .filter(t => t !== typeInfo.name); // exclude the current type itself
        if (relatedTypes.length > 0) {
            md.addTitle('Related Types', 2);
            const typeLinks = relatedTypes
                .map(typeName => `- [${typeName}](../types/${typeName}.md)`)
                .join('\n');
            md.addParagraph(typeLinks);
        }
    }

    return md.toString();
}