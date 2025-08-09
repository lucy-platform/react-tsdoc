import React, { forwardRef, FunctionComponent, memo } from 'react';

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

declare enum Type {
    Text = 'text',
    Number = 'number'
}
interface TestComponent02props extends TestComponent01Props {
    name: string,
    type: Type
}

export interface TestComponent02handles {
    save: () => boolean
}
/**
 * 
 * @export
 * 
 * Forward ref component 
 */
export const TestComponent02: React.ForwardRefExoticComponent<React.RefAttributes<TestComponent02handles> & TestComponent02props> = forwardRef((props, ref) => {

    return <></>
})

const BaseComponent: FunctionComponent<TestComponent01Props> = (props) => {
    return <></>
}

/**
 * @export
 * 
 * Memorized component
 */
export const MemorizedComponent = memo(BaseComponent);

export const MemorizedForwardRefComponent = memo(TestComponent02);

export default TestComponent01;