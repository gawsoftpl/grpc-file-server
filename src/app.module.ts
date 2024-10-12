import { ConfigModule } from '@nestjs/config';
import { Config } from './config/config';
import { DynamicModule, Module } from '@nestjs/common';
import {AppService} from "./app/app.service";
import {GrpcClientOptions} from "./grpc/grpc.options";
import {AppController} from "./app/app.controller";
import {HealthModule} from "./healthz/healthz.module";

@Module({})
export class AppModule {
    static register(): DynamicModule {

        return {
            module: AppModule,
            providers: [
                GrpcClientOptions,
                AppService,
            ],
            imports: [
                ConfigModule.forRoot({
                    load: [() => Config],
                }),
                HealthModule
            ],
            exports: [ConfigModule],
            controllers: [AppController],
        };
    }
}
