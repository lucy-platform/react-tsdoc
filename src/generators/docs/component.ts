import { IReactComponent, IDocInfo, IComponentPropDocumentation, IInterfaceDeclaration } from '../../core/types';
import { MarkdownBuilder } from '../markdown';
import { parseTSDocComment } from '../../core/parser';
import { linkedType, getRelatedTypes } from '../../utils/type-helpers';
import { generateComplexComponentType } from '../types/module';

export function generatePropDocs(inf: IInterfaceDeclaration): IComponentPropDocumentation[] {
    const results: IComponentPropDocumentation[] = [];
    for (const prop of inf.members) {
        const propDoc: IComponentPropDocumentation = { examples: [], name: prop.name, summary: '', type: prop.type };
        [propDoc.summary, propDoc.examples] = parseTSDocComment(prop.comment);
        results.push(propDoc);
    }
    return results;
}

export function extractTypesFromComplex(comp: IReactComponent, docInfo: IDocInfo): { propType: string, refType?: string } {
    let actualComp = comp;
    if (comp.referencedComponent && docInfo.components[comp.referencedComponent]) {
        actualComp = docInfo.components[comp.referencedComponent];
    }
    return {
        propType: actualComp.propType,
        refType: actualComp.refType
    };
}

/**
 * Render a single @example block's content.
 * Content may contain: optional title text, one or more code fences, and trailing text.
 * Text segments are rendered as level-4 headings; code fences as code blocks.
 *
 * Example source shape that triggers the split:
 *   @example Title for first snippet:
 *   ```
 *   <Foo />
 *   ```
 *
 *   Title for next snippet:   ← ends up appended to this block by TSDoc
 */
function renderExampleContent(md: MarkdownBuilder, content: string): void {
    // Match each ``` ... ``` fence (non-greedy, dotall)
    const FENCE_RE = /```[\s\S]*?```/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = FENCE_RE.exec(content)) !== null) {
        const textBefore = content.substring(lastIndex, match.index).trim().replace(/:$/, '');
        if (textBefore) md.addTitle(textBefore, 4);
        md.addCode(match[0]);
        lastIndex = match.index + match[0].length;
    }

    // Any text after the last code fence (e.g. title of the next @example block)
    const trailing = content.substring(lastIndex).trim().replace(/:$/, '');
    if (trailing) md.addTitle(trailing, 4);
}

export function generateComponentDocFromDocInfo(comp: IReactComponent, docInfo: IDocInfo, moduleName?: string, dependentTypes?: Set<string>) {
    const md = new MarkdownBuilder();
    const [summary, examples] = parseTSDocComment(comp.comment);

    md.addTitle(comp.name, 1);
    if (summary) md.addParagraph(summary);

    md.addTitle('Installation', 2);
    const moduleImport = moduleName || 'your-module';
    md.addCode(`import { ${comp.name} } from '${moduleImport}';`);

    md.addTitle('Signature', 2);
    const complexType = generateComplexComponentType(comp, docInfo, false);
    md.addCode(`const ${comp.name}: ${complexType}`);

    if (examples.length > 0) {
        md.addTitle('Examples', 2);
        for (const example of examples) {
            renderExampleContent(md, example.summary);
        }
    }

    const { propType, refType } = extractTypesFromComplex(comp, docInfo);
    const propInterface = docInfo.interfaces[propType];
    if (propInterface && propInterface.members.length > 0) {
        md.addTitle('Properties', 2);
        const propTableData = propInterface.members.map(member => ({
            Name: member.name,
            Type: linkedType(member.type, docInfo),
            Mandatory: member.isOptional ? 'No' : 'Yes',
            'Default Value': member.defaultValue || '-',
            'Example Value': member.exampleValue || '-'
        }));
        md.addTable(propTableData);
    }

    if (refType) {
        const refInterface = docInfo.interfaces[refType];
        if (refInterface && refInterface.members.length > 0) {
            md.addTitle('Ref Handlers', 2);
            md.addParagraph('Available methods through ref:');
            const handlersTable = refInterface.members.map(member => {
                const [memberSummary] = parseTSDocComment(member.comment || '');
                return {
                    Method: member.name,
                    Type: linkedType(member.type, docInfo),
                    Description: memberSummary || '-'
                };
            });
            md.addTable(handlersTable);
        }
    }

    if (dependentTypes) {
        const relatedTypes = getRelatedTypes(comp, dependentTypes, docInfo);
        if (relatedTypes.length > 0) {
            md.addTitle('Related Types', 2);
            const typeLinks = relatedTypes.map(typeName => `- [${typeName}](../types/${typeName}.md)`).join('\n');
            md.addParagraph(typeLinks);
        }
    }

    return md.toString();
}