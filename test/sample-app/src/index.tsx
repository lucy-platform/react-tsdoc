
import React from 'react';
import TestComponent01, { ABC, Type } from './components/TestComponent01';
import useToast from './components/Toast';


type TestFunction = (type: Type) => void;

interface ReturnType {

}
/**
 * @export 
 * 
 * test function
 */
function Test(param1: string, param2: number): ReturnType {
const toast = useToast()
    return {}
}

/**
 * @export
 */
function Test2() {
    return {
        name: 'abc',
    }
}

/**
 * @export 
 * test arrow function
 */
const Test3: TestFunction = () => { }


type CustomHook = {
    save: () => Promise<boolean>
}
/**
 * @export
 */
const useTest = (): CustomHook => {

    return {
        save: async () => true
    }
}

/**
 * @export
 */
function useTest2(ct: ABC) { }

/**
 * @export
 * Generic type for parsed search parameters, ensuring non-object values are strings.
 */
export type SearchParams<T> = {
    [K in keyof T]: T[K] extends object ? T[K] : string;
};


/**
 * @export
 * Shared utility function to parse URLSearchParams into a typed object.
 * Handles JSON-encoded values using the toJSON utility.
 *
 * @param params - The URLSearchParams object to parse.
 * @returns A typed object containing the parsed search parameters.
 *
 * @example
 * ```
 * const params = new URLSearchParams('?name=John&age=30');
 * const result = parseSearchParams<{ name: string; age: string }>(params);
 * // result: { name: 'John', age: '30' }
 * ```
 *
 * @example
 * ```
 * const params = new URLSearchParams('?user={"name":"John","age":30}');
 * const result = parseSearchParams<{ user: { name: string; age: number } }>(params);
 * // result: { user: { name: 'John', age: 30 } }
 * ```
 */
function parseSearchParams<T extends Record<string, any>>(params: URLSearchParams): SearchParams<T> {
    const result: Record<string, any> = {};

    for (const [key, value] of params.entries()) {
        if (value.startsWith('{') || value.startsWith('[')) {
            result[key] = toJSON(value, null) || value;
        } else {
            result[key] = value;
        }
    }

    return result as SearchParams<T>;
}

/**
 * @export
 * Generic function with type guards
 */
export function hasValue<T>(value: T | null | undefined, allowZero?: boolean, allowNegative?: boolean): value is NonNullable<T> {
    if (value === null || value === undefined) return false;
    if (typeof value === 'number') {
        if (!allowZero && value === 0) return false;
        if (!allowNegative && value < 0) return false;
    }
    return true;
}

/**
 * @export
 * Performs a text search with case sensitivity option
 * 
 * @example
 * ```
 * const found = textSearch('Hello World', 'world', true);
 * console.log(found); // true
 * ```
 */
export function textSearch(value: any, query: string, ignoreCase: boolean = false): boolean {

    const _value = toStr(value)

    if (ignoreCase) {
        return _value?.toLowerCase().indexOf(query?.toLowerCase()) !== -1;
    } else {
        return _value?.indexOf(query) !== -1;
    }
}