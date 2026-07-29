/**
 * MESH — sample loaner/rental fleet inventory.
 *
 * Seeds the rental-db session store so the fleet dashboard and mobile intake
 * loaner selection render immediately without a DB table.
 */
import type { RentalVehicle } from '@/components/sales/types';

export const MOCK_FLEET: RentalVehicle[] = [
  {
    id: 'FL-01',
    makeModel: '2023 Toyota Corolla',
    licensePlate: '8ABC123',
    currentStatus: 'AVAILABLE',
    currentMileage: 24310,
    fuelLevel: 85,
  },
  {
    id: 'FL-02',
    makeModel: '2022 Honda CR-V',
    licensePlate: '7XYZ889',
    currentStatus: 'RENTED',
    startingMileage: 30110,
    currentMileage: 30110,
    fuelLevel: 60,
    assignedCustomer: 'Nadia Farah',
    assignedLeadId: 'lead-1004',
    assignedAgent: 'Carlos Mendez',
    expectedReturnDate: '2026-08-01',
  },
  {
    id: 'FL-03',
    makeModel: '2023 Ford Escape',
    licensePlate: '9LMN456',
    currentStatus: 'AVAILABLE',
    currentMileage: 41120,
    fuelLevel: 70,
  },
  {
    id: 'FL-04',
    makeModel: '2021 Nissan Sentra',
    licensePlate: '5QRS221',
    currentStatus: 'MAINTENANCE',
    currentMileage: 58990,
    fuelLevel: 40,
  },
  {
    id: 'FL-05',
    makeModel: '2024 Chevrolet Malibu',
    licensePlate: '3TUV778',
    currentStatus: 'AVAILABLE',
    currentMileage: 19005,
    fuelLevel: 95,
  },
  {
    id: 'FL-06',
    makeModel: '2022 Kia Sportage',
    licensePlate: '6WXY334',
    currentStatus: 'RENTED',
    startingMileage: 12040,
    currentMileage: 12210,
    fuelLevel: 50,
    assignedCustomer: 'Leo Marsh',
    assignedLeadId: 'lead-1002',
    assignedAgent: 'Renee Park',
    expectedReturnDate: '2026-07-29',
  },
];
