import { Transport, GrpcOptions } from '@nestjs/microservices';
import { join } from 'path';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ReflectionService } from '@grpc/reflection';
import { ServerCredentials } from '@grpc/grpc-js'

@Injectable()
export class GrpcClientOptions {
    constructor(private configService: ConfigService) {
    }

    getOptions(): GrpcOptions {
        return {
            transport: Transport.GRPC,
            options: {
                loader: {
                    keepCase: true,
                    longs: String,
                    enums: String,
                    defaults: true,
                    oneofs: true,
                },
                url: this.configService.get('grpc.listen'),
                credentials: ServerCredentials.createInsecure(),
                package: ['fileserver', 'grpc.health.v1'],
                onLoadPackageDefinition: (pkg, server) => {
                    return new ReflectionService(pkg).addToServer(server);
                },
                protoPath: [
                    join(__dirname, '/../../protos/fileserver.proto'),
                    join(__dirname, '/../../protos/health.proto'),
                ],
            },
        };
    }
}