import React, { JSX } from "react";
import ToastContext from './ToastContext';


/**
 * @export
 */
type IToastContent = () => JSX.Element
/**
 * This function is invoked to display a toast (notification popup).
 * 
 * @param icon - the icon to show in the notification popup
 * @param title - the title to show in the notification popup
 * @param content - the content to show in the notification popup
 * @param showCloseBtn - set to true to show a close button on the notification popup
 * @param autoClose - if set to true, the notification popup will automatically dismiss itself after a preset duration
 * @param closeAfter - how many seconds to wait before closing - only applicable if autoClose is set to true
 * @param onClose - callback that is invoked after the toast is closed
 * 
 * @export
 * 
 */
interface IPartialContent {
    icon?: string | IToastContent,
    title?: string | IToastContent,
    content: string | IToastContent,
    showCloseBtn?: boolean,
    autoClose?: boolean,
    onClose?: () => void,
    closeAfter?: number,
}
/**
 * @export
 */
type IToast = (content: string | IPartialContent) => void;

/**
 * The result of calling the useToast hook. This gives you methods to invoke notifications for success, errors, etc...
 * All notifications work the same way but have different styles.
 * @export
 */
interface IToastResult {
    success: IToast,
    error: IToast,
    warning: IToast,
    info: IToast,
    custom: IToast,
    remove: IRemove
}

/**
 * The react hook for creating toasts
 * @export
 */
type ToastHook = () => IToastResult;

/**
 * @export
 */
type IRemove = (id: string) => void;


/**
 * This hook allows you to popup notifications on the bottom right corner of the screen
 * (also known as toasts)
 * 
 *  @example
 * ```
 *  let toast = useToast();
 *  toast.success("Item has been added");
 * ```
 * 
 * @example
 * ```
 *  let toast = useToast();
 *  toast.success({title:'Info',content:'Item has been added'});
 * ```
 *  
 * @example
 * ```
 *  let toast = useToast();
 *  toast.error({title:'Failed!',content:'Failed to add item',closeAfter:5,onClose:()=>{console.log('toast closed')}});
 * ```
 * 
 * @example
 * With custom icon
 * ```
 *  let toast = useToast();
 *  toast.success({icon: "path/to/your/image", content: "Toast with custom icon"});
 * ```
 * 
 * @example
 * Custom toast example
 * ```
 *  let toast = useToast();
 *  toast.custom({content: "Custom Toast message"});
 * ```
 * 
 * @example
 * Custom toast example
 * ```
 *  let toast = useToast();
 *  toast.custom({
 *      content: () => <div className="content">
 *              You custom toast content
 *          </div>
 *  );
 * ```
 * 
 * 
 * @export
 */
const useToast: ToastHook = () => {
    const context = React.useContext(ToastContext);

    return {
        success: context.success,
        error: context.error,
        warning: context.warning,
        info: context.info,
        custom: context.custom,
        remove: context.remove
    }
}

export default useToast;