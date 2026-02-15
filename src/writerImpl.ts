import { Writer } from './interfaces/interfaces';
import fs from 'fs';
import { Observable, Subject } from 'rxjs';

export class WriterImpl implements Writer {
  writeFile(path: string, data: DataView): Observable<void> {
    const obj = new Subject<void>();

    fs.writeFile(path, data, (err) => {
      if (err) {
        obj.error(err);
        return;
      }
      obj.next();
      obj.complete();
    });
    return obj.asObservable();
  }
}
