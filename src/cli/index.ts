import { program } from 'commander';
import { generateDocs, generateTypeDefinition } from '../index';
import { logError } from '../utils/logger';

export function main() {
    try {
        program
            .name('react-tsdoc')
            .description('Generate docs for React components')
            .version('0.2.4');

        program
            .command('types')
            .description('Generate type definitions')
            .argument('[input.ts]', 'Input TypeScript file')
            .argument('[output.d.ts]', 'Output declaration file')
            .option('--module-name <name>', 'Module name for type definitions')
            .action((input, output, options) => {
                generateTypeDefinition(input, output, options.moduleName);
            });

        program
            .command('docs')
            .description('Generate Markdown documentation')
            .argument('[input.ts]', 'Input TypeScript file')
            .argument('[output-folder]', 'Output folder for documentation')
            .option('--module-name <name>', 'Module name for documentation')
            .action((input, output, options) => {
                generateDocs(input, output, options.moduleName);
            });

        program.parse(process.argv);
    } catch (e) {
        logError(e);
    }
}