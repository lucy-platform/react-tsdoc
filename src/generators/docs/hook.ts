import { IReactHook, IDocInfo } from '../../core/types';
import { MarkdownBuilder } from '../markdown';
import { parseTSDocComment } from '../../core/parser';
import { getRelatedTypes } from '../../utils/type-helpers';

export function generateHookDocFromDocInfo(hook: IReactHook, docInfo: IDocInfo, moduleName?: string, dependentTypes?: Set<string>) {
    const md = new MarkdownBuilder();
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
        for (const example of examples) {
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