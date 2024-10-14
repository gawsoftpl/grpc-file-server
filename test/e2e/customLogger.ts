import { LoggerService} from '@nestjs/common'

export class CustomLogger implements LoggerService {
    error(message: any, ...optionalParams: any[]): any {
        console.log(message)
    }

    log(message: any, ...optionalParams: any[]): any {
        console.log(message)
    }

    warn(message: any, ...optionalParams: any[]): any {
        console.warn(message)
    }

    debug(message){
       console.debug(message)
    }

}