import {
  Inject,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { User } from '../entity/user.entity';
import { Between, Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { RegisterUserDto } from '../dto/register-user.dto';
import { OtpService } from 'src/auth/services/otp.service';
import { JwtService } from '@nestjs/jwt';
import { UpdateUserDto } from '../dto/update-user.dto';
import { ScanHistory } from 'src/food/entity/scan-history.entity';
import { UserSummaryResponseDto } from '../dto/summary-response.dto';
import { FoodHistory } from 'src/food/entity/food-history.entity';
import { Food } from 'src/food/entity/food.entity';
import { FoodGroup } from 'src/food/entity/food-group.entity';

@Injectable()
export class UserService {
  constructor(
    private otpService: OtpService,
    @Inject('JwtLoginService') private jwtLoginService: JwtService,
    @InjectRepository(User) private readonly userRepository: Repository<User>,
    @InjectRepository(ScanHistory)
    private scanHistoryRepository: Repository<ScanHistory>,
    @InjectRepository(FoodHistory)
    private foodHistoryRepository: Repository<FoodHistory>,
    @InjectRepository(Food)
    private foodRepository: Repository<Food>,
    @InjectRepository(FoodGroup)
    private foodGroupRepository: Repository<FoodGroup>,
  ) {}

  async getUserFoodHistory(userId: string): Promise<any> {
    // Ambil riwayat makanan user berdasarkan user_id
    const foodHistories = await this.foodHistoryRepository
      .createQueryBuilder('foodHistory')
      .leftJoinAndSelect('foodHistory.food', 'food') // Gabungkan dengan tabel food
      .where('foodHistory.user_id = :userId', { userId })
      .orderBy('foodHistory.created_at', 'DESC')
      .getMany();

    // Ambil semua data FoodGroup untuk memetakan ID ke nama
    const foodGroups = await this.foodGroupRepository.find();
    const foodGroupMap = foodGroups.reduce((map, group) => {
      map[group.id] = group.name;
      return map;
    }, {});

    // Proses data untuk mengganti ID tags dengan nama
    const foodHistoryWithTags = foodHistories.map((foodHistory) => {
      const food = foodHistory.food;
      const tagNames = food.tags
        .map((tagId) => foodGroupMap[tagId] || null)
        .filter(Boolean);

      return {
        id: food.id,
        name: food.name,
        grade: food.grade,
        tags: tagNames, // Ubah ID tags menjadi nama
        image_url: food.image_url,
        type: food.type,
      };
    });

    return foodHistoryWithTags;
  }

  async getUserSummary(userId: string): Promise<UserSummaryResponseDto> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);

    const result = await this.foodHistoryRepository
      .createQueryBuilder('foodHistory')
      .innerJoinAndSelect('foodHistory.food', 'food')
      .select('SUM(food.calories)', 'totalCalories')
      .addSelect('SUM(food.sugar)', 'totalSugar')
      .addSelect('SUM(food.protein)', 'totalProtein')
      .where('foodHistory.user_id = :userId', { userId })
      .andWhere('foodHistory.created_at >= :today', { today })
      .andWhere('foodHistory.created_at < :tomorrow', { tomorrow })
      .getRawOne();
    const roundToTwoDecimals = (value: number | null) =>
      value ? Math.round(value * 100) / 100 : 0;
    return {
      name: user.name,
      calories: roundToTwoDecimals(result.totalCalories),
      protein: roundToTwoDecimals(result.totalProtein),
      sugar: roundToTwoDecimals(result.totalSugar),
    };
  }

  async createUser(request: RegisterUserDto): Promise<User> {
    try {
      await this.validateCreateUserRequest(request);
      const user = this.userRepository.create({
        ...request,
        password: await bcrypt.hash(request.password, 10),
      });
      const savedUser = await this.userRepository.save(user);
      return savedUser;
    } catch (error) {
      if (error instanceof UnprocessableEntityException) {
        throw error;
      }
      throw new Error('Failed to create user.');
    }
  }
  async updateUser(
    userId: string,
    updateUserDto: UpdateUserDto,
  ): Promise<User> {
    try {
      const user = await this.userRepository.findOneBy({ id: userId });
      if (!user) {
        throw new UnauthorizedException('User not found');
      }
      // Update data user
      Object.assign(user, updateUserDto);
      return await this.userRepository.save(user);
    } catch (error) {
      throw new InternalServerErrorException(error);
    }
  }
  async resetPassword(userId, newPassword): Promise<User> {
    try {
      const user = await this.userRepository.findOneBy({ id: userId });
      if (!user) {
        throw new UnauthorizedException('User not Found');
      }
      const hashedPassword = await bcrypt.hash(newPassword, 10);
      user.password = hashedPassword;
      await this.userRepository.save(user);
      return user;
    } catch (error) {
      throw new InternalServerErrorException(error);
    }
  }

  async getUserByEmail(email: string): Promise<User> {
    // Cari user berdasarkan email
    const user = await this.userRepository.findOne({
      where: { email },
    });

    // Jika user tidak ditemukan
    if (!user) {
      throw new UnprocessableEntityException('User not found.');
    }

    // Pisahkan password sebelum mengembalikan user
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password, verified_at, ...userWithoutPassword } = user;

    // Kembalikan user tanpa password
    return userWithoutPassword as User;
  }

  async getUser(id: string): Promise<User> {
    // Cari user berdasarkan email
    const user = await this.userRepository.findOne({
      where: { id },
    });

    // Jika user tidak ditemukan
    if (!user) {
      throw new UnprocessableEntityException('User not found.');
    }

    // Pisahkan password sebelum mengembalikan user
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password, verified_at, ...userWithoutPassword } = user;

    // Kembalikan user tanpa password
    return userWithoutPassword as User;
  }

  private async validateCreateUserRequest(request: RegisterUserDto) {
    try {
      const user = await this.userRepository.findOne({
        where: { email: request.email },
      });

      if (user) {
        console.log('error');
        throw new UnprocessableEntityException('Email already exists.');
      }
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (err) {
      if (err instanceof UnprocessableEntityException) {
        throw err;
      }

      console.log('error: Unexpected error');
      throw new Error('Error validating user request.');
    }
  }
  async getUserEmailById(userId: string): Promise<string> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
    });

    // Jika user tidak ditemukan
    if (!user) {
      throw new UnprocessableEntityException('User not found.');
    }

    return user.email;
  }
  async getTodayScanCount(userId: string): Promise<any> {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0); // Atur waktu ke awal hari

    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999); // Atur waktu ke akhir hari

    let scan_quota = await this.scanHistoryRepository.count({
      where: {
        user: { id: userId },
        created_at: Between(startOfDay, endOfDay), // Gunakan FindOperator 'LessThanOrEqual'
      },
    });

    scan_quota = 5 - scan_quota;

    return {
      scan_quota,
    };
  }
}
