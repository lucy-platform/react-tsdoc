# React TypeScript Document Generator

**React TypeScript Document Generator** is a command-line tool that helps you automatically generate **clear, well-structured documentation** and **type definitions** for your React components, hooks, and utility functions written in TypeScript.  

It scans your code, reads **TSDoc-style comments**, and produces:
- **Markdown documentation** with prop tables, examples, and type signatures.
- **Type definition files** (`.d.ts`) for easy API sharing.

Whether you’re building a reusable UI library or maintaining an internal component set, this tool saves you from writing documentation manually and keeps it consistent with your code.

---

## Why Use This Tool?
- **Stay in sync**: Documentation is generated directly from your source code.
- **Easy to maintain**: Update your comments, re-run the tool, and everything stays current.
- **Supports multiple React patterns**: Functional components, class components, hooks, and more.
- **Clear output**: Easy-to-read Markdown for documentation sites and type definitions for developers.

---

## Installation

Install globally via npm:

```bash
npm install -g react-tsdoc
````

---

## How It Works

1. **You write code with TSDoc comments** describing your components, props, hooks, or functions.
2. **Run the CLI commands** to generate documentation and type definitions.
3. **Share or publish** the generated docs and `.d.ts` files.

---

## Commands & Parameters

The CLI provides two main commands:

### 1. Generate Type Definitions

```bash
react-tsdoc types <path-to-root-ts> <output.d.ts> --module-name <module-name>
```

**Purpose**: Creates a `.d.ts` type definition file for your public API.

**Parameters**:

* `<path-to-root-ts>` — Entry point TypeScript file (e.g., `src/index.ts`).
* `<output.d.ts>` — Path to save the generated type definitions (e.g., `dist/types.d.ts`).
* `--module-name <module-name>` — The name of your library/module (e.g., `my-lib`).

---

### 2. Generate Documentation

```bash
react-tsdoc docs <path-to-root-ts> <output-folder> --module-name <module-name>
```

**Purpose**: Generates Markdown documentation in categorized folders (`components`, `hooks`, etc.).

**Parameters**:

* `<path-to-root-ts>` — Entry point TypeScript file.
* `<output-folder>` — Folder to store generated Markdown files (e.g., `docs`).
* `--module-name <module-name>` — Your library/module name.

---

## Supported Code Patterns

The generator supports common React patterns and outputs clear documentation for each.

### Functional Components

Declared with `React.FC` or `React.FunctionComponent`.

```typescript
interface ILabelProps {
  /** The label text to display */
  value: string;
}
/**
 * A simple label component
 * @export
 * @example <Label value="Hello" />
 */
const Label: React.FC<ILabelProps> = ({ value }) => <span>{value}</span>;
```
---

### Class Components

Extend `React.Component` with props (and optional state).

```typescript
interface ILabelProps {
  /** The label text to display */
  value: string;
}
/**
 * A class-based label component
 * @export
 * @example <Label2 value="Hello" />
 */
class Label2 extends React.Component<ILabelProps> {
  render() {
    return <span>{this.props.value}</span>;
  }
}
```
---

### ForwardRef Components

Expose refs using `React.forwardRef`.

```typescript
interface IRef { focus(): void; }
interface IInputProps { value: string; }
/**
 * An input with ref support
 * @export
 * @example <Input ref={ref} value="Hello" />
 */
const Input = React.forwardRef<IRef, IInputProps>((props, ref) => (
  <input ref={ref} value={props.value} />
));
```
---

### Memoized Components

Use `React.memo` to optimize rendering.

```typescript
interface IMemoProps { value: string; }
/**
 * A memoized label
 * @export
 * @example <MemoedLabel value="Hello" />
 */
const MemoLabel: React.FC<IMemoProps> = ({ value }) => <span>{value}</span>;
const MemoedLabel = React.memo(MemoLabel);
```
---

## Functions & Hooks

### Functions

Standalone utility functions.

```typescript
/**
 * Adds two numbers
 * @export
 * @example add(2, 3) // Returns 5
 */
function add(a: number, b: number): number {
  return a + b;
}
```
---

### Hooks

Custom hooks starting with `use`.

```typescript
/**
 * Fetches data from a URL
 * @export
 * @hook
 * @example const data = useFetchData('url');
 */
function useFetchData(url: string): string {
  return "data";
}
```
---

## Supported TSDoc Annotations

| Tag        | Description                                                                               |
| ---------- | ----------------------------------------------------------------------------------------- |
| `@export`  | Marks the item for inclusion in docs and type definitions. Required for public API items. |
| `@example` | Adds usage examples (supports multiple).                                                  |
| `@hook`    | Optional for hooks; classifies them in generated docs.                                    |

---

## Example Workflow

1. Document your code with TSDoc annotations.
2. Generate type definitions:

   ```bash
   react-tsdoc types src/index.ts dist/types.d.ts --module-name my-ui
   ```
3. Generate documentation:

   ```bash
   react-tsdoc docs src/index.ts docs --module-name my-ui
   ```

---

## Tips for Best Results

* Write **clear, concise comments** for props, parameters, and return values.
* Include **examples** that developers can copy and paste.
* Keep your public API clean and well-annotated.

---

## Contributing

We welcome contributions!
Here’s how you can help:

1. **Report issues** or suggest features on [GitHub](https://github.com/lucy-platform/react-tsdoc/issues).
2. **Submit pull requests** with bug fixes or enhancements.
3. Improve this documentation with clearer examples or new sections.

Before contributing, please:

* Fork the repository.
* Create a new branch for your changes.
* Ensure your code follows the existing coding style.
* Add or update tests when applicable.

---

Happy documenting! 🚀