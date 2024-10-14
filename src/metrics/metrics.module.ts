import { Module } from "@nestjs/common";
import {makeCounterProvider, makeGaugeProvider, PrometheusModule} from "@willsoto/nestjs-prometheus";
import {Config} from "../config/config";

const providers = [
    makeCounterProvider({
        name: 'files_uploaded',
        help: 'How many files uploaded',
    }),
    makeCounterProvider({
        name: 'files_uploaded_bytes',
        help: 'How many bytes uploaded',
    }),
    makeCounterProvider({
        name: 'files_downloaded',
        help: 'How many files downloaded',
    }),
    makeCounterProvider({
        name: 'files_downloaded_bytes',
        help: 'How many bytes downloaded',
    }),
    makeCounterProvider({
        name: 'files_memory_downloaded',
        help: 'How many files downloaded from memory',
    }),
    makeCounterProvider({
        name: 'files_memory_downloaded_bytes',
        help: 'How many bytes downloaded from memory',
    }),
    makeGaugeProvider({
        name: 'hdd_storage',
        help: 'How hdd storage usage',
    }),
    makeGaugeProvider({
        name: 'memory_storage',
        help: 'How many memory storage usage',
    }),
    makeGaugeProvider({
        name: 'files_uploading',
        help: 'How many upload requests are running',
    }),
    makeGaugeProvider({
        name: 'files_downloading',
        help: 'How many download requests are running',
    }),
    makeCounterProvider({
        name: 'garbage_collection_files',
        help: 'How many files remove by garbage collection',
    }),
    makeCounterProvider({
        name: 'garbage_collection_bytes',
        help: 'How many bytes remove by garbage collection',
    }),
    makeCounterProvider({
        name: 'release_files',
        help: 'How many times remove files for make room for new file',
    }),
];

@Module({
    providers: providers,
    exports: providers,
    imports: [
        PrometheusModule.register({
            defaultMetrics: {
                enabled: Config.metrics.defaultMetrics,
            },
        }),
    ],
})
export class MetricsModule {}