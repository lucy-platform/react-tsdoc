import { IFunctionSignature, IDocInfo } from '../../core/types';
import { MarkdownBuilder } from '../markdown';
import { parseTSDocComment } from '../../core/parser';
import { getRelatedTypes } from '../../utils/type-helpers';

export function generateFunctionDocFromDocInfo(func: IFunctionSignature, docInfo: IDocInfo, moduleName?: string, dependentTypes?: Set<string>) {
    const md = new MarkdownBuilder();
    const [summary, examples] = parseTSDocComment(func.comment);
    const functionName = Object.keys(docInfo.functions).find(key => docInfo.functions[key] === func) || 'function';

    md.addTitle(functionName, 1);
    if (summary) md.addParagraph(summary);

    md.addTitle('Installation', 2);
    const moduleImport = moduleName || 'your-module';
    md.addCode(`import { ${functionName} } from '${moduleImport}';`);

    md.addTitle('Signature', 2);
    const params = func.parameters.map(p => `${p.name}: ${p.type}`).join(', ');
    const signature = `function ${functionName}(${params}): ${func.return}`;
    md.addCode(signature);

    if (examples.length > 0) {
        md.addTitle('Examples', 2);
        for (const example of examples) {
            md.addCode(example.summary);
        }
    }

    if (dependentTypes) {
        const relatedTypes = getRelatedTypes(func, dependentTypes, docInfo);
        if (relatedTypes.length > 0) {
            md.addTitle('Related Types', 2);
            const typeLinks = relatedTypes.map(typeName => `- [${typeName}](../types/${typeName}.md)`).join('\n');
            md.addParagraph(typeLinks);
        }
    }

    return md.toString();
}