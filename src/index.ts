import * as ts from 'typescript';
import * as path from 'path';
import { IDocInfo, IDocObject, IComponentDocumentation, IHookDocumentation, ITypeDocumentation, ComponentFlags } from './core/types';
import { walkTree, validateProgram, getSources } from './core/analyzer';
import { generateComponentDocFromDocInfo, generatePropDocs } from './generators/docs/component';
import { generateHookDocFromDocInfo } from './generators/docs/hook';
import { generateTypeDocFromDocInfo } from './generators/docs/type';
import { generateFunctionDocFromDocInfo } from './generators/docs/function';
import { generateExportModule, collectAllDependentTypes } from './generators/types/module';
import { createDirectories, writeFile } from './utils/file';
import { logDebug, logError } from './utils/logger';
import { hasExportAnnotation } from './utils/type-helpers';

export function load(root: string): IDocInfo {
    // Find the project's tsconfig.json
    const projectDir = path.dirname(root);
    const tsconfigPath = ts.findConfigFile(projectDir, ts.sys.fileExists, 'tsconfig.json');
    
    let program: ts.Program;
    let options: ts.CompilerOptions;

    if (tsconfigPath) {
        logDebug('Loading tsconfig from', tsconfigPath);
        
        // Read and parse the tsconfig.json properly
        const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
        if (configFile.error) {
            throw new Error(`Error reading tsconfig: ${configFile.error.messageText}`);
        }

        // Parse the configuration with proper context
        const parsedConfig = ts.parseJsonConfigFileContent(
            configFile.config,
            ts.sys,
            path.dirname(tsconfigPath),
            undefined,
            tsconfigPath
        );

        if (parsedConfig.errors?.length) {
            parsedConfig.errors.forEach(error => {
                const message = typeof error.messageText === 'string' 
                    ? error.messageText 
                    : error.messageText.messageText;
                
                // Treat "No inputs were found" as a debug message since we're providing files programmatically
                if (error.code === 18003) {
                    logDebug('TypeScript config info:', message);
                } else if (error.category === 0) { // Warning
                    logDebug('TypeScript config warning:', message);
                } else if (error.category === 1) { // Error
                    logError('TypeScript config error:', message);
                } else { // Info or other
                    logDebug('TypeScript config info:', message);
                }
            });
        }

        options = parsedConfig.options;
        
        // Ensure essential options for our use case
        options.skipLibCheck = true;
        options.allowSyntheticDefaultImports = true;
        options.esModuleInterop = true;
        
        logDebug('Using tsconfig.json compiler options with paths:', Object.keys(options.paths || {}));
        
        // Create program with the parsed configuration
        program = ts.createProgram([root], options);
    } else {
        // Fallback to default options
        logDebug('No tsconfig found, using default options');
        options = {
            jsx: ts.JsxEmit.React,
            target: ts.ScriptTarget.ESNext,
            module: ts.ModuleKind.CommonJS,
            strict: false,
            skipLibCheck: true,
            esModuleInterop: true,
            allowSyntheticDefaultImports: true,
        };
        program = ts.createProgram([root], options);
    }

    logDebug('Loading', root);
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

    return docInfo;
}

export function generateDocs(root: string, outputPath: string, moduleName?: string) {
    const docInfo = load(root);
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
    const docInfo = load(root);
    const moduleCode = generateExportModule(docInfo, { moduleName: moduleName || 'module' });
    writeFile(outputPath, moduleCode);
}