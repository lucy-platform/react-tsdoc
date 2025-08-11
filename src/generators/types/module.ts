import { IDocInfo, IExportModuleOptions, IReactComponent } from '../../core/types';
import { hasExportAnnotation } from '../../utils/type-helpers';
import { indentCode } from '../../utils/file';
import { linkedType } from '../../utils/type-helpers';

export function collectAllDependentTypes(docInfo: IDocInfo): Set<string> {
    const collectedTypes = new Set<string>();
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

    function collectDependencies(typeName: string) {
        if (visited.has(typeName)) return;
        visited.add(typeName);

        if (docInfo.interfaces?.[typeName]) {
            collectedTypes.add(typeName);
            const intf = docInfo.interfaces[typeName];
            const extendsMatch = intf.code.match(/extends\s+([^{]+)/);
            if (extendsMatch) {
                const extendedTypes = extractTypeNames(extendsMatch[1]);
                extendedTypes.forEach(t => collectDependencies(t));
            }
            intf.members.forEach(member => {
                const memberTypes = extractTypeNames(member.type);
                memberTypes.forEach(t => collectDependencies(t));
            });
        }

        if (docInfo.unions?.[typeName]) {
            collectedTypes.add(typeName);
            const union = docInfo.unions[typeName];
            union.items.forEach(item => {
                const itemTypes = extractTypeNames(item);
                itemTypes.forEach(t => collectDependencies(t));
            });
        }

        if (docInfo.enums?.[typeName]) {
            collectedTypes.add(typeName);
        }

        if (docInfo.typeAliases?.[typeName]) {
            collectedTypes.add(typeName);
            const alias = docInfo.typeAliases[typeName];
            const aliasTypes = extractTypeNames(alias.type);
            aliasTypes.forEach(t => collectDependencies(t));
        }

        if (docInfo.functions[typeName]) {
            collectedTypes.add(typeName);
            const func = docInfo.functions[typeName];
            const returnTypes = extractTypeNames(func.return);
            returnTypes.forEach(t => collectDependencies(t));
            func.parameters.forEach(param => {
                const paramTypes = extractTypeNames(param.type);
                paramTypes.forEach(t => collectDependencies(t));
            });
        }
    }

    Object.values(docInfo.components).forEach(comp => {
        if (hasExportAnnotation(comp.comment)) {
            const propTypes = extractTypeNames(comp.propType);
            propTypes.forEach(t => collectDependencies(t));
            if (comp.stateType) {
                const stateTypes = extractTypeNames(comp.stateType);
                stateTypes.forEach(t => collectDependencies(t));
            }
            if (comp.refType) {
                const refTypes = extractTypeNames(comp.refType);
                refTypes.forEach(t => collectDependencies(t));
            }
            if (comp.referencedComponent && docInfo.components[comp.referencedComponent]) {
                const refComp = docInfo.components[comp.referencedComponent];
                const refPropTypes = extractTypeNames(refComp.propType);
                refPropTypes.forEach(t => collectDependencies(t));
                if (refComp.stateType) {
                    const refStateTypes = extractTypeNames(refComp.stateType);
                    refStateTypes.forEach(t => collectDependencies(t));
                }
                if (refComp.refType) {
                    const refRefTypes = extractTypeNames(refComp.refType);
                    refRefTypes.forEach(t => collectDependencies(t));
                }
            }
        }
    });

    Object.values(docInfo.functions).forEach(func => {
        if (hasExportAnnotation(func.comment)) {
            const returnTypes = extractTypeNames(func.return);
            returnTypes.forEach(t => collectDependencies(t));
            func.parameters.forEach(param => {
                const paramTypes = extractTypeNames(param.type);
                paramTypes.forEach(t => collectDependencies(t));
            });
        }
    });

    Object.values(docInfo.hooks).forEach(hook => {
        if (hasExportAnnotation(hook.comment)) {
            const returnTypes = extractTypeNames(hook.type);
            returnTypes.forEach(t => collectDependencies(t));
            hook.parameters.forEach(param => {
                const paramTypes = extractTypeNames(param.type);
                paramTypes.forEach(t => collectDependencies(t));
            });
        }
    });

    return collectedTypes;
}

export function generateComplexComponentType(comp: IReactComponent, docInfo: IDocInfo, linkTypes?: boolean): string {
    let baseType = '';
    const typeHelper = linkTypes ? (type: string) => linkedType(type, docInfo) : (type: string) => type;

    if (comp.referencedComponent && docInfo.components[comp.referencedComponent]) {
        const referencedComp = docInfo.components[comp.referencedComponent];
        if (referencedComp.type === 'class') {
            baseType = `React.Component<${typeHelper(referencedComp.propType)}, ${typeHelper(referencedComp.stateType || 'any')}>`;
        } else if (referencedComp.type === 'forwardRef') {
            baseType = `React.ForwardRefExoticComponent<React.RefAttributes<${typeHelper(referencedComp.refType || 'any')}> & ${typeHelper(referencedComp.propType)}>`;
        } else {
            baseType = `React.FunctionComponent<${typeHelper(referencedComp.propType)}>`;
        }
    } else {
        if (comp.type === 'class') {
            baseType = `React.Component<${typeHelper(comp.propType)}, ${typeHelper(comp.stateType || 'any')}>`;
        } else if (comp.type === 'forwardRef') {
            baseType = `React.ForwardRefExoticComponent<React.RefAttributes<${typeHelper(comp.refType || 'any')}> & ${typeHelper(comp.propType)}>`;
        } else {
            baseType = `React.FunctionComponent<${typeHelper(comp.propType)}>`;
        }
    }

    if (comp.wrappers && comp.wrappers.some(w => /\bmemo$/.test(w))) {
        baseType = `React.MemoExoticComponent<${baseType}>`;
    }

    return baseType;
}

export function generateExportModule(docInfo: IDocInfo, options: IExportModuleOptions) {
    let code = '';
    const openedModule = !!(options && options.moduleName);
    if (openedModule) {
        code += `declare module "${options.moduleName}" {\n`;
    }

    const emitted = new Set<string>();
    const dependentTypes = collectAllDependentTypes(docInfo);

    for (const typeName of dependentTypes) {
        if (emitted.has(typeName)) continue;

        if (docInfo.interfaces?.[typeName]) {
            const intf = docInfo.interfaces[typeName];
            const cleanCode = intf.code.replace(/^\s*export\s*/, '');
            const toEmit = '\n' + intf.comment + '\n' + 'export ' + cleanCode + '\n';
            code += indentCode(toEmit, '    ');
            emitted.add(typeName);
        } else if (docInfo.unions?.[typeName]) {
            const union = docInfo.unions[typeName];
            const cleanCode = union.code.replace(/^\s*export\s*/, '');
            const toEmit = '\n' + union.comment + '\n' + 'export ' + cleanCode + '\n';
            code += indentCode(toEmit, '    ');
            emitted.add(typeName);
        } else if (docInfo.enums?.[typeName]) {
            const enumObj = docInfo.enums[typeName];
            const cleanCode = enumObj.code.replace(/^\s*(declare|export)\s*/, '');
            const toEmit = '\n' + enumObj.comment + '\n' + 'export ' + cleanCode + '\n';
            code += indentCode(toEmit, '    ');
            emitted.add(typeName);
        } else if (docInfo.typeAliases?.[typeName]) {
            const alias = docInfo.typeAliases[typeName];
            const cleanCode = alias.code.replace(/^\s*export\s*/, '');
            const toEmit = '\n' + alias.comment + '\n' + 'export ' + cleanCode + '\n';
            code += indentCode(toEmit, '    ');
            emitted.add(typeName);
        } else if (docInfo.functions?.[typeName]) {
            const func = docInfo.functions[typeName];
            const cleanCode = func.code.replace(/^\s*export\s*/, '');
            const paramsTxt = func.parameters.map(p => `${p.name}: ${p.type}`).join(', ');
            const commentBlock = func.comment ? '\n' + func.comment + '\n' : '\n';
            const declaration = `export type ${typeName} = (${paramsTxt}) => ${func.return};\n`;
            code += indentCode(commentBlock + declaration, '    ');
            emitted.add(typeName);
        }
    }

    Object.values(docInfo.components).forEach(comp => {
        if (emitted.has(comp.name)) return;
        if (hasExportAnnotation(comp.comment)) {
            const complexType = generateComplexComponentType(comp, docInfo);
            const commentBlock = comp.comment ? '\n' + comp.comment + '\n' : '\n';
            const declaration = `export const ${comp.name}: ${complexType};\n`;
            code += indentCode(commentBlock + declaration, '    ');
            emitted.add(comp.name);
        }
    });

    Object.keys(docInfo.functions).forEach(fname => {
        if (emitted.has(fname)) return;
        const f = docInfo.functions[fname];
        if (hasExportAnnotation(f.comment)) {
            const paramsTxt = f.parameters.map(p => `${p.name}: ${p.type}`).join(', ');
            const commentBlock = f.comment ? '\n' + f.comment + '\n' : '\n';
            const declaration = `export function ${fname}(${paramsTxt}): ${f.return};\n`;
            code += indentCode(commentBlock + declaration, '    ');
            emitted.add(fname);
        }
    });

    Object.values(docInfo.hooks).forEach(hook => {
        if (emitted.has(hook.name)) return;
        if (hasExportAnnotation(hook.comment)) {
            const paramsTxt = hook.parameters.map(p => `${p.name}: ${p.type}`).join(', ');
            const commentBlock = hook.comment ? '\n' + hook.comment + '\n' : '\n';
            const declaration = `export function ${hook.name}(${paramsTxt}): ${hook.type};\n`;
            code += indentCode(commentBlock + declaration, '    ');
            emitted.add(hook.name);
        }
    });

    if (openedModule) {
        code += `\n}\n`;
    }

    return code;
}