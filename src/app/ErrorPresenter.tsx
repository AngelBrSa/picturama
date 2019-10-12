import copyToClipboard from 'copy-text-to-clipboard'

import { msg } from 'common/i18n/i18n'

import toaster from 'app/Toaster'
import store from 'app/state/store'
import { createErrorToastProps } from 'app/ui/main/ErrorToast'

import { mapStackTrace } from 'sourcemapped-stacktrace'


let errorToastKey: string | undefined = undefined
let errorReport = ''


export function showError(msg: string, error?: unknown) {
    console.error(msg, error)
    if (!errorReport) {
        errorReport = createBasicErrorReport(msg, 'app')
        new Promise(
            resolve => {
                if (error instanceof Error) {
                    errorReport += '\n\n' + error.name + ': ' + error.message
                    mapStackTrace(error.stack, resolve)
                } else {
                    resolve(null)
                }
            })
            .then((mappedStack: string[] | null) => {
                if (mappedStack) {
                    errorReport += '\n' + mappedStack.join('\n')
                }
                showErrorToast()
            })
    }
}


export function showExternalError(processName: string, msg: string, errorStack?: string) {
    if (errorReport) {
        return
    }

    errorReport = createBasicErrorReport(msg, processName)
    if (errorStack) {
        errorReport += '\n\n' + errorStack
    }
    showErrorToast()
}


function createBasicErrorReport(msg: string, processName: string): string {
    const state = store.getState()
    const uiConfig = state.data.uiConfig
    return `${msg}\n\nVersion: ${uiConfig.version}\nPlatform: ${uiConfig.platform}\nLocale: ${uiConfig.locale}\nProcess: ${processName}`
}


function showErrorToast() {
    errorToastKey = toaster.show(createErrorToastProps({
        report: errorReport,
        onCopyReport,
        onDismiss
    }))
}


function onCopyReport() {
    copyToClipboard('```\n' + errorReport + '\n```')
    toaster.dismiss(errorToastKey!)
    toaster.show({
        intent: 'success',
        icon: 'tick',
        message: msg('ErrorController_copied')
    })
}


function onDismiss() {
    errorToastKey = undefined
    errorReport = ''
}
