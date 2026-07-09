import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { OpenBucketService } from '@openbucket/nestjs';

/**
 * Creates the `uploads` bucket once, when the app boots. Uploading into a
 * missing bucket throws, so this runs before the first request lands.
 */
@Injectable()
export class BucketBootstrap implements OnModuleInit {
  private readonly logger = new Logger(BucketBootstrap.name);

  constructor(private readonly ob: OpenBucketService) {}

  async onModuleInit(): Promise<void> {
    if (!(await this.ob.bucketExists('uploads'))) {
      await this.ob.createBucket('uploads');
      this.logger.log("Created bucket 'uploads'");
    }
  }
}
