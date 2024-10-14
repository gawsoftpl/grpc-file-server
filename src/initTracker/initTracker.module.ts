import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import {InitTrackerService} from "../helpers/InitTrackerService";

@Module({
    imports: [TerminusModule],
    exports: [InitTrackerService],
    providers: [InitTrackerService],
})
export class InitTrackerModule {}
