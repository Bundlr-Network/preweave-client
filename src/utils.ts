import { AxiosResponse } from "axios";

/**
 * Throws an error if the provided axios reponse has a status code != 200, optionally checks a list of status codes to ignore.
 * @param res an axios response
 * @param exceptions an array of numerical status codes to allow
 * @returns nothing if the status code is 200
 */
export function checkAndThrow(res: AxiosResponse<any>, context?: string, exceptions?: number[]): void {
    if (res?.status && !(exceptions ?? []).includes(res.status) && res.status != 200) {
        throw new Error(`HTTP Error: ${context}: ${res.status} ${typeof res.data !== "string" ? res.statusText : res.data}`);
    }
}