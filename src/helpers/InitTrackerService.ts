import {Injectable, Logger} from '@nestjs/common';

@Injectable()
export class InitTrackerService {

    private initializedModules: Record<string, boolean>
    private logs: Logger = new Logger(InitTrackerService.name)

    constructor() {
        this.initializedModules = {}
    }

    trackModuleInit(moduleName: string) {
        this.initializedModules[moduleName] = false;
        this.logs.log(`${moduleName} has been start initialize.`);
    }

    trackModuleFinished(moduleName: string)
    {
        this.initializedModules[moduleName] = true;
        this.logs.log(`${moduleName} initialied has been finished.`);
    }

    getInitializedModules() {
        return this.initializedModules;
    }

    allModulesInitFinished(): boolean
    {
        return Object.values(this.initializedModules).every(item => item)
    }
}
