import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { MicroserviceOptions } from '@nestjs/microservices';
import {GrpcClientOptions} from "./grpc/grpc.options";
import {ConfigService} from "@nestjs/config";
import {MetricsModule} from "./metrics/metrics.module";
import {ExpressAdapter} from "@nestjs/platform-express";
import * as express from 'express';
import {Config} from "./config/config";

export async function bootstrap() {

    const metricsServer = express()
    const metricsApp = await NestFactory.create(
        MetricsModule,
        new ExpressAdapter(metricsServer),
    );


    const app = await NestFactory.create(AppModule.register());
    const grpcClientOptions = app.get(GrpcClientOptions);
    app.connectMicroservice<MicroserviceOptions>(grpcClientOptions.getOptions());
    await app.startAllMicroservices();
    app.enableShutdownHooks()

    await app.init();
    await metricsApp.init();

    const configService = app.get(ConfigService)
    app.useLogger([configService.get('logs.level')])

    metricsApp.listen(Config.metrics.port)

    return app;
}

bootstrap();
