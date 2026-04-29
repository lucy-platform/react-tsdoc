import { program } from 'commander';
import { generateDocs, generateTypeDefinition } from '../index';
import { logError } from '../utils/logger';

export function main() {
    try {
        program
            .name('react-tsdoc')
            .description('Generate docs for React components')
            .version('0.2.7');

        program
            .command('types')
            .description('Generate type definitions')
            .argument('[input.ts]', 'Input TypeScript file')
            .argument('[output.d.ts]', 'Output declaration file')
            .option('--module-name <name>', 'Module name for type definitions')
            .option('--tsconfig <path>', 'Path to tsconfig.json (defaults to nearest tsconfig.json)')
            .action((input, output, options) => {
                generateTypeDefinition(input, output, options.moduleName, options.tsconfig);
            });

        program
            .command('docs')
            .description('Generate Markdown documentation')
            .argument('[input.ts]', 'Input TypeScript file')
            .argument('[output-folder]', 'Output folder for documentation')
            .option('--module-name <name>', 'Module name for documentation')
            .option('--tsconfig <path>', 'Path to tsconfig.json (defaults to nearest tsconfig.json)')
            .action((input, output, options) => {
                generateDocs(input, output, options.moduleName, options.tsconfig);
            });

        program.parse(process.argv);
    } catch (e) {
        logError(e);
    }
}