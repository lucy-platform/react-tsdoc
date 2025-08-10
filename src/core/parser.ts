import * as tsdoc from '@microsoft/tsdoc';
import { ComponentFlags, IExample } from './types';

export function extractActualContentFromDocMess(node: tsdoc.DocNode): string {
    if (!node) return '';
    let result = '';
    if (node instanceof tsdoc.DocExcerpt) {
        result += node.content.toString();
    }
    for (const childNode of node.getChildNodes()) {
        result += extractActualContentFromDocMess(childNode);
    }
    return result;
}

export function parseTSDocComment(comment: string): [string, IExample[], ComponentFlags] {
    const config = new tsdoc.TSDocConfiguration();
    config.addTagDefinition(
        new tsdoc.TSDocTagDefinition({
            tagName: '@export',
            syntaxKind: tsdoc.TSDocTagSyntaxKind.ModifierTag,
            allowMultiple: false
        })
    );
    config.addTagDefinition(
        new tsdoc.TSDocTagDefinition({
            tagName: '@hook',
            syntaxKind: tsdoc.TSDocTagSyntaxKind.ModifierTag,
            allowMultiple: false
        })
    );

    const parser = new tsdoc.TSDocParser(config);
    const ctx = parser.parseString(comment);
    const summary = extractActualContentFromDocMess(ctx.docComment.summarySection);
    const examples: IExample[] = [];
    let flags: ComponentFlags = ComponentFlags.None;

    for (const block of ctx.docComment.customBlocks) {
        if (block.blockTag.tagName === '@example') {
            examples.push({ summary: extractActualContentFromDocMess(block.content) });
        }
    }

    if (ctx.docComment.modifierTagSet.hasTagName('@export')) {
        flags |= ComponentFlags.Export;
    }
    if (ctx.docComment.modifierTagSet.hasTagName('@hook')) {
        flags |= ComponentFlags.Hook;
    }

    return [summary, examples, flags];
}