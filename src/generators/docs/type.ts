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