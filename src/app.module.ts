import { ConfigModule } from '@nestjs/config';
import { Config } from './config/config';
import { DynamicModule, Module } from '@nestjs/common';
import {AppService} from "./app/app.service";
import {GrpcClientOptions} from "./grpc/grpc.options";
import {AppController} from "./app/app.controller";
import {HealthModule} from "./healthz/healthz.module";
import {MemoryStorage} from "./storages/memory.storage";
import {DiskStorage} from "./storages/disk.storage";
import {InitTrackerService} from "./helpers/InitTrackerService";
import {InitTrackerModule} from "./initTracker/initTracker.module";
import {MetricsModule} from "./metrics/metrics.module";

@Module({})
export class AppModule {
    static register(): DynamicModule {

        return {
            module: AppModule,
            providers: [
                GrpcClientOptions,
                AppService,
                {
                    provide: 'MemoryStorage',
                    useClass: MemoryStorage
                },
                {
                    provide: "DiskStorage",
                    useClass: DiskStorage
                }
            ],
            imports: [
                ConfigModule.forRoot({
                    load: [() => Config],
                }),
                MetricsModule,
                InitTrackerModule,
                HealthModule
            ],
            exports: [ConfigModule],
            controllers: [AppController],
        };
    }
}
