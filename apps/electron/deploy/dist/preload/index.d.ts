declare const electronAPI: {
    dsh: {
        getPort: () => Promise<any>;
        onReady: (callback: (data: {
            port: number;
            url: string;
        }) => void) => () => Electron.IpcRenderer;
    };
    dialog: {
        openDirectory: () => Promise<any>;
        saveFile: (options: Electron.SaveDialogOptions) => Promise<any>;
    };
    shell: {
        openExternal: (url: string) => Promise<any>;
    };
    app: {
        getVersion: () => Promise<any>;
        getPath: (name: string) => Promise<any>;
    };
    menu: {
        action: (action: string) => void;
    };
    platform: NodeJS.Platform;
    isDev: boolean;
};
declare global {
    interface Window {
        electronAPI: typeof electronAPI;
    }
}
export {};
//# sourceMappingURL=index.d.ts.map