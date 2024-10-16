import {BeforeApplicationShutdown, Controller, Logger} from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';
import {InitTrackerService} from "../helpers/InitTrackerService";

@Controller('health')
export class HealthzController implements BeforeApplicationShutdown {

    private logs: Logger = new Logger(HealthzController.name);
    private shutdownSignal: boolean

    constructor(
        private initTrackerService: InitTrackerService
    ) {
        this.shutdownSignal = false
    }

    @GrpcMethod('Health', 'Check')
    async check() {

        let status = 'NOT_SERVING';
        try {
            if (
                !this.shutdownSignal
                && this.initTrackerService.allModulesInitFinished()
            )
                status = 'SERVING';
        } catch (err) {
            this.logs.error(err);
        }

        return {
            status: status,
        };
    }

    beforeApplicationShutdown(): Promise<void>
    {
        return new Promise<void>((resolve) => {
            this.shutdownSignal = true
            this.logs.log('Received application shutdown signal. Wait 30s for close all operations')
            setTimeout(() => {
                this.logs.log('Closing app')
                resolve()
            }, 30_000)
        })
    }

}
