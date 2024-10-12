import { Controller, Logger } from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';

@Controller('health')
export class HealthzController {
    private logs: Logger = new Logger(HealthzController.name);

    constructor(
    ) {}

    @GrpcMethod('Health', 'Check')
    async check() {
        let status = 'NOT_SERVING';
        try {
            status = 'SERVING';
        } catch (err) {
            this.logs.error(err);
        }

        return {
            status: status,
        };
    }
}
