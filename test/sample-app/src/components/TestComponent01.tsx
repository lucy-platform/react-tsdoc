import React from 'react';

interface TestComponent01Props {
    /** prop one  */
    prop1: string;
    /** prop two */
    prop2: number
}
/**
 * @export 
 * 
 * My TestComponent
 * 
 * @example 
 * ```
 * <TestComponent />
 * ```
 */
const TestComponent01: React.FunctionComponent<TestComponent01Props> = (props) => {

    return <></>
}

export const TestComponent02: React.FunctionComponent<TestComponent01Props> = (props) => {

    return <></>
}
export default TestComponent01;