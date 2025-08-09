import TestComponent01 from "./components/TestComponent01";
type TestFunction = () => void;

interface ReturnType {

}
/**
 * @export 
 * 
 * test function
 */
function Test(): ReturnType {

    return {}
}

function Test2() { }

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
function useTest2() { }