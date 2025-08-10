
import React from 'react';
import TestComponent01, { ABC, Type } from './components/TestComponent01';

type TestFunction = (type: Type) => void;

interface ReturnType {

}
/**
 * @export 
 * 
 * test function
 */
function Test(param1: string, param2: number): ReturnType {

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