import * as ts from 'typescript';
import { IDocInfo, IDocObject, IExportModuleOptions, IComponentDocumentation, IHookDocumentation, ITypeDocumentation, ComponentFlags } from './core/types';
import { walkTree, validateProgram, getSources } from './core/analyzer';
import { generateComponentDocFromDocInfo, generatePropDocs } from './generators/docs/component';
import { generateHookDocFromDocInfo } from './generators/docs/hook';
import { generateTypeDocFromDocInfo } from './generators/docs/type';
import { generateFunctionDocFromDocInfo } from './generators/docs/function';
import { generateExportModule, collectAllDependentTypes } from './generators/types/module';
import { createDirectories, writeFile } from './utils/file';
import { logDebug, logError } from './utils/logger';
import { hasExportAnnotation } from './utils/type-helpers';
import { parseTSDocComment } from './core/parser';

export function generateDocObject(docInfo: IDocInfo): IDocObject {
    const components: IComponentDocumentation[] = [];
    for (const cn in docInfo.components) {
        const componentDoc: IComponentDocumentation = { examples: [], name: cn, props: [], summary: '', flags: ComponentFlags.None };
        const componentInfo = docInfo.components[cn];
        [componentDoc.summary, componentDoc.examples, componentDoc.flags] = parseTSDocComment(componentInfo.comment);

        const propType = docInfo.interfaces[componentInfo.propType];
        if (propType) {
            componentDoc.props = generatePropDocs(propType);
        }
        components.push(componentDoc);
    }

    const hooks: IHookDocumentation[] = [];
    for (const hi in docInfo.hooks) {
        const hook = docInfo.hooks[hi];
        const hookDoc: IHookDocumentation = { name: hook.name, flags: ComponentFlags.None, summary: '', examples: [] };
        [hookDoc.summary, hookDoc.examples, hookDoc.flags] = parseTSDocComment(hook.comment);
        hooks.push(hookDoc);
    }

    const types: ITypeDocumentation[] = [];
    for (const k of Object.keys(docInfo.interfaces)) {
        const inf = docInfo.interfaces[k];
        const typeDoc: ITypeDocumentation = { examples: [], name: inf.name, summary: '', type: 'interface', code: '', flags: ComponentFlags.None };
        typeDoc.code = inf.code;
        [typeDoc.summary, typeDoc.examples, typeDoc.flags] = parseTSDocComment(inf.comment);
        types.push(typeDoc);
    }
    for (const k of Object.keys(docInfo.functions)) {
        const inf = docInfo.functions[k];
        const typeDoc: ITypeDocumentation = { examples: [], name: k, summary: '', type: 'function', code: '', flags: ComponentFlags.None };
        typeDoc.code = inf.code;
        [typeDoc.summary, typeDoc.examples, typeDoc.flags] = parseTSDocComment(inf.comment);
        types.push(typeDoc);
    }
    for (const k of Object.keys(docInfo.unions)) {
        const inf = docInfo.unions[k];
        const typeDoc: ITypeDocumentation = { examples: [], name: k, summary: '', type: 'union', code: '', flags: ComponentFlags.None };
        typeDoc.code = inf.code;
        [typeDoc.summary, typeDoc.examples, typeDoc.flags] = parseTSDocComment(inf.comment);
        types.push(typeDoc);
    }

    return { components, hooks, types };
}

export function load(root: string): [IDocInfo, IDocObject] {
    const options: ts.CompilerOptions = {
        jsx: ts.JsxEmit.React,
    };

    logDebug('Loading', root);
    const program = ts.createProgram([root], options);
    logDebug('Compiled');

    const checker = program.getTypeChecker();
    validateProgram(program);
    logDebug('Validated');

    const sources = getSources(program);
    const docInfo: IDocInfo = { interfaces: {}, components: {}, hooks: {}, functions: {}, unions: {}, enums: {}, typeAliases: {} };

    for (const source of sources) {
        logDebug('Loading', source);
        const sourceNode = program.getSourceFile(source);
        if (!sourceNode) continue;

        try {
            walkTree(sourceNode, docInfo, checker);
        } catch (error) {
            logError(`Error in ${source}: ${error}`);
        }
    }

    const docs = generateDocObject(docInfo);
    return [docInfo, docs];
}

export function generateDocs(root: string, outputPath: string, moduleName?: string) {
    const [docInfo, docs] = load(root);
    if (outputPath.endsWith('/')) outputPath = outputPath.substring(0, outputPath.length - 1);

    createDirectories([
        `${outputPath}/components`,
        `${outputPath}/types`,
        `${outputPath}/hooks`,
        `${outputPath}/functions`
    ]);

    const dependentTypes = collectAllDependentTypes(docInfo);

    for (const cn in docInfo.components) {
        const componentInfo = docInfo.components[cn];
        if (hasExportAnnotation(componentInfo.comment)) {
            const md = generateComponentDocFromDocInfo(componentInfo, docInfo, moduleName, dependentTypes);
            const path = `${outputPath}/components/${componentInfo.name}.md`;
            logDebug('Writing component', componentInfo.name, 'to', path);
            writeFile(path, md);
        }
    }

    for (const typeName of dependentTypes) {
        if (docInfo.interfaces?.[typeName]) {
            const typeInfo = docInfo.interfaces[typeName];
            const md = generateTypeDocFromDocInfo(typeInfo, 'interface', docInfo, moduleName, dependentTypes);
            const path = `${outputPath}/types/${typeInfo.name}.md`;
            logDebug('Writing type', typeInfo.name, 'to', path);
            writeFile(path, md);
        } else if (docInfo.unions?.[typeName]) {
            const typeInfo = docInfo.unions[typeName];
            const md = generateTypeDocFromDocInfo(typeInfo, 'union', docInfo, moduleName, dependentTypes);
            const path = `${outputPath}/types/${typeName}.md`;
            logDebug('Writing type', typeName, 'to', path);
            writeFile(path, md);
        } else if (docInfo.enums?.[typeName]) {
            const typeInfo = docInfo.enums[typeName];
            const md = generateTypeDocFromDocInfo(typeInfo, 'enum', docInfo, moduleName, dependentTypes);
            const path = `${outputPath}/types/${typeInfo.name}.md`;
            logDebug('Writing type', typeInfo.name, 'to', path);
            writeFile(path, md);
        } else if (docInfo.typeAliases?.[typeName]) {
            const typeInfo = docInfo.typeAliases[typeName];
            const md = generateTypeDocFromDocInfo(typeInfo, 'type', docInfo, moduleName, dependentTypes);
            const path = `${outputPath}/types/${typeInfo.name}.md`;
            logDebug('Writing type', typeInfo.name, 'to', path);
            writeFile(path, md);
        } else if (docInfo.functions?.[typeName]) {
            const typeInfo = docInfo.functions[typeName];
            const md = generateFunctionDocFromDocInfo(typeInfo, docInfo, moduleName, dependentTypes);
            const path = `${outputPath}/types/${typeName}.md`;
            logDebug('Writing function type', typeName, 'to', path);
            writeFile(path, md);
        }
    }

    for (const hn in docInfo.hooks) {
        const hookInfo = docInfo.hooks[hn];
        if (hasExportAnnotation(hookInfo.comment)) {
            const md = generateHookDocFromDocInfo(hookInfo, docInfo, moduleName, dependentTypes);
            const path = `${outputPath}/hooks/${hookInfo.name}.md`;
            logDebug('Writing hook', hookInfo.name, 'to', path);
            writeFile(path, md);
        }
    }

    for (const fn in docInfo.functions) {
        if (!dependentTypes.has(fn)) {
            const functionInfo = docInfo.functions[fn];
            if (hasExportAnnotation(functionInfo.comment)) {
                const md = generateFunctionDocFromDocInfo(functionInfo, docInfo, moduleName, dependentTypes);
                const path = `${outputPath}/functions/${fn}.md`;
                logDebug('Writing function', fn, 'to', path);
                writeFile(path, md);
            }
        }
    }
}

export function generateTypeDefinition(root: string, outputPath: string, moduleName: string) {
    const [docInfo, docs] = load(root);
    const moduleCode = generateExportModule(docs, docInfo, { moduleName: moduleName || 'module' });
    writeFile(outputPath, moduleCode);
}