import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { MicroserviceOptions } from '@nestjs/microservices';
import {GrpcClientOptions} from "./grpc/grpc.options";
import {ConfigService} from "@nestjs/config";

export async function bootstrap() {
    const app = await NestFactory.create(AppModule.register());
    const grpcClientOptions = app.get(GrpcClientOptions);
    app.connectMicroservice<MicroserviceOptions>(grpcClientOptions.getOptions());
    await app.startAllMicroservices();
    await app.init();
    const configService = app.get(ConfigService)
    app.useLogger([configService.get('logs.level')])
    return app;
}

bootstrap();
