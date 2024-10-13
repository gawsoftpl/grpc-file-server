import { GrpcReflection } from 'grpc-js-reflection-client';
import { ChannelCredentials } from '@grpc/grpc-js';

export const grpcClient = async (
  host: string,
  packageName: string,
  credentials: ChannelCredentials,
) => {

  const reflectionClient = new GrpcReflection(host, credentials);
  const descriptor = await reflectionClient.getDescriptorBySymbol(packageName);

  return descriptor.getPackageObject({
    keepCase: true,
    enums: String,
    longs: String,
  });
};
