import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthzController } from './healthz.controller';
import {InitTrackerModule} from "../initTracker/initTracker.module";

@Module({
    imports: [TerminusModule, InitTrackerModule],
    controllers: [HealthzController],
    providers: [],
})
export class HealthModule {}
