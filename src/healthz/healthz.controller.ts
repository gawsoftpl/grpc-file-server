import { Controller, Logger } from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';
import {InitTrackerService} from "../helpers/InitTrackerService";

@Controller('health')
export class HealthzController {
    private logs: Logger = new Logger(HealthzController.name);

    constructor(
        private initTrackerService: InitTrackerService
    ) {}

    @GrpcMethod('Health', 'Check')
    async check() {

        let status = 'NOT_SERVING';
        try {
            if (this.initTrackerService.allModulesInitFinished())
                status = 'SERVING';
        } catch (err) {
            this.logs.error(err);
        }

        return {
            status: status,
        };
    }
}
