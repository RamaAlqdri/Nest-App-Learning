import {
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
  HttpStatus,
  UseGuards,
  Get,
  Query,
  Body,
  Req,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import * as multer from 'multer';
import { ResponseWrapper } from 'src/common/wrapper/response.wrapper';
import { JwtLoginAuthGuard } from 'src/auth/jwt/guards/jwt.guard';
import { FoodService } from '../services/food.service';
import { FoodResponseWrapper } from 'src/common/wrapper/food-response.wrapper';
import { AnalyzeFoodSaveDto } from '../dto/analyze-food-save.dto';
import { EatFoodDTO } from '../dto/eat-food-save.dto';
import { RecommendationService } from '../services/recommendation.service';
import { StorageService } from '../services/cloud-storage.service';

@Controller('food')
export class FoodController {
  constructor(
    private readonly foodService: FoodService,
    private readonly recommendationService: RecommendationService,
    private readonly storageService: StorageService,
  ) {}

  @Get('detail')
  @UseGuards(JwtLoginAuthGuard)
  async getFoodDetails(
    @Req() req: any,
    @Query('id') id: number,
  ): Promise<ResponseWrapper<any>> {
    const result = await this.foodService.getFoodById(req.user.id, id);
    if (!result) {
      return Promise.reject(
        new ResponseWrapper(
          HttpStatus.INTERNAL_SERVER_ERROR,
          'Failed to retrieve data',
        ),
      );
    }

    return new ResponseWrapper(
      HttpStatus.OK,
      'Food Data retrieved successfully',
      result,
    );
  }

  @Get('news')
  @UseGuards(JwtLoginAuthGuard)
  async getNews(): Promise<ResponseWrapper<any>> {
    try {
      const result = await this.foodService.fetchZetizenNews();
      return new ResponseWrapper(
        HttpStatus.OK,
        'News data retrieved successfully',
        result,
      );
    } catch (error) {
      return Promise.reject(
        new ResponseWrapper(
          HttpStatus.INTERNAL_SERVER_ERROR,
          'Failed to retrieve data',
          error,
        ),
      );
    }
  }

  @Get('filter')
  @UseGuards(JwtLoginAuthGuard)
  async getPaginatedFoods(
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 10,
    @Query('name') name: string = '',
    @Query('tags') tags: string = '',
  ): Promise<FoodResponseWrapper<any>> {
    const tagsArray = tags ? tags.split(',').map(Number) : [];

    const result = await this.foodService.getFoods(
      page,
      limit,
      name,
      tagsArray,
    );
    if (!result) {
      return Promise.reject(
        new FoodResponseWrapper(
          HttpStatus.INTERNAL_SERVER_ERROR,
          'Failed to retrieve foods data',
        ),
      );
    }

    return new FoodResponseWrapper(
      HttpStatus.OK,
      'Foods Data retrieved successfully',
      result.data,
      result.total,
      result.page,
      result.limit,
      result.totalPages,
    );

    // return result;
  }

  @Post('save')
  @UseGuards(JwtLoginAuthGuard)
  async saveFood(
    @Req() req: any,
    @Body() eatFoodDto: EatFoodDTO,
  ): Promise<ResponseWrapper<any>> {
    try {
      const foodHistory = await this.foodService.addFoodHistory(
        req.user.id,
        eatFoodDto.food_id,
      );

      if (!foodHistory.id) {
        return Promise.reject(
          new ResponseWrapper(
            HttpStatus.INTERNAL_SERVER_ERROR,
            'Failed to save food',
          ),
        );
      }

      if (eatFoodDto.food_rate) {
        await this.foodService.setFoodRate(
          req.user.id,
          eatFoodDto.food_id,
          eatFoodDto.food_rate,
        );
      }

      return Promise.resolve(
        new ResponseWrapper(HttpStatus.CREATED, 'Food Saved Successfully'),
      );
    } catch (error) {
      throw new Error(error);
    }
  }

  @Post('analyze/save')
  @UseInterceptors(
    FileInterceptor('image', {
      storage: multer.memoryStorage(),
    }),
  )
  @UseGuards(JwtLoginAuthGuard)
  async analyzeImageAndSave(
    @Req() req: any,
    @UploadedFile() file: Express.Multer.File,
    @Body() analyzeFoodSaveDto: AnalyzeFoodSaveDto,
  ): Promise<ResponseWrapper<any>> {
    // console.log(analyzeFoodSaveDto);
    if (!file) {
      return Promise.reject(new ResponseWrapper(400, 'No file uploaded'));
    }
    try {
      const savedFood = await this.foodService.saveFood(
        analyzeFoodSaveDto,
        req.user.id,
      );

      // console.log(savedFood.id);
      if (!savedFood.id) {
        return Promise.reject(
          new ResponseWrapper(
            HttpStatus.INTERNAL_SERVER_ERROR,
            'Failed to save food',
          ),
        );
      }

      const bucketName = process.env.GCP_BUCKET_NAME;
      const filePath = `food/${savedFood.id}`;

      const publicUrl = await this.storageService.uploadFile(
        bucketName,
        filePath,
        file.buffer,
      );
      // console.log(publicUrl);
      if (!publicUrl) {
        return Promise.reject(
          new ResponseWrapper(
            HttpStatus.INTERNAL_SERVER_ERROR,
            'Image Upload failed',
          ),
        );
      }

      const updatedFood = await this.foodService.updateFoodImage(
        savedFood.id,
        publicUrl,
      );

      if (!updatedFood) {
        return Promise.reject(
          new ResponseWrapper(
            HttpStatus.INTERNAL_SERVER_ERROR,
            'Failed to update food image',
          ),
        );
      }

      if (analyzeFoodSaveDto.food_rate) {
        await this.foodService.setFoodRate(
          req.user.id,
          savedFood.id,
          analyzeFoodSaveDto.food_rate,
        );
      }

      return Promise.resolve(
        new ResponseWrapper(HttpStatus.CREATED, 'Food Saved Successfully'),
      );
    } catch (error) {
      console.log(error);
    }
  }
  @Post('analyze')
  @UseInterceptors(
    FileInterceptor('image', {
      storage: multer.memoryStorage(),
    }),
  )
  @UseGuards(JwtLoginAuthGuard)
  async analyzeImage(
    @Req() req: any,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<ResponseWrapper<any>> {
    if (!file) {
      return Promise.reject(new ResponseWrapper(400, 'No file uploaded'));
    }
    try {
      const analyzeResult = await this.foodService.analyzeFoodNutrition(
        req.user.id,
        file,
      );
      if (!analyzeResult) {
        return Promise.reject(
          new ResponseWrapper(
            HttpStatus.INTERNAL_SERVER_ERROR,
            'Analyze Error',
          ),
        );
      }

      await this.foodService.addScanHistory(req.user.id);

      return Promise.resolve(
        new ResponseWrapper(
          HttpStatus.CREATED,
          'Food Analyze Successfully',
          analyzeResult,
        ),
      );
    } catch (error) {
      console.log(error);
      return Promise.reject(
        new ResponseWrapper(
          HttpStatus.INTERNAL_SERVER_ERROR,
          'An error occurred during file upload',
          error,
        ),
      );
    }
  }

  @Get('recommendation')
  @UseGuards(JwtLoginAuthGuard)
  async getRecommendation(@Req() req: any): Promise<ResponseWrapper<any>> {
    try {
      const recommendation = await this.recommendationService.runRecommendation(
        req.user.id,
      );
      if (!recommendation) {
        return Promise.reject(
          new ResponseWrapper(
            HttpStatus.INTERNAL_SERVER_ERROR,
            'Failed to retrieve recommendation',
          ),
        );
      }

      return new ResponseWrapper(
        HttpStatus.OK,
        'Recommendation retrieved successfully',
        recommendation,
      );
    } catch (error) {
      console.log(error);
      return Promise.reject(new ResponseWrapper(error));
    }
  }
}
