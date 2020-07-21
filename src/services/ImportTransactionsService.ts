import { getRepository, getCustomRepository, In } from 'typeorm';
import parseCSV from 'csv-parse';
import path from 'path';
import fs from 'fs';

import uploadConfig from '../config/upload';

import Transaction from '../models/Transaction';
import Category from '../models/Category';
import TransactionsRepository from '../repositories/TransactionsRepository';

interface Request {
  filename: string;
}

interface TransactionTmp {
  title: string;
  type: 'income' | 'outcome';
  value: number;
  category: string;
}

class ImportTransactionsService {
  async execute({ filename }: Request): Promise<Transaction[]> {
    const lines = parseCSV({ from_line: 2, delimiter: ', ' });

    const filePath = path.join(uploadConfig.directory, filename);
    const readStream = fs.createReadStream(filePath);

    const parsedCSV = readStream.pipe(lines);

    const transactionsTmp: TransactionTmp[] = [];
    const transactionsRepository = getCustomRepository(TransactionsRepository);
    const categoriesRepository = getRepository(Category);

    parsedCSV.on('data', async line => {
      const [title, type, value, category] = line;

      transactionsTmp.push({ title, type, value, category });
    });

    await new Promise(resolve => parsedCSV.on('end', resolve));

    // Removendo categorias repetidas
    const categories = transactionsTmp
      .map(transactionTmp => transactionTmp.category)
      .filter((element, position, thisArray) => {
        return thisArray.indexOf(element) === position;
      });

    /**
     * Buscando categorias que já existem no banco de dados
     */
    const existentCategories = await categoriesRepository.find({
      where: {
        title: In(categories),
      },
    });

    // Criando array contendo apenas os títulos das categorias
    const categoryTitles = existentCategories.map(category => category.title);

    // Removendo categorias que já estão criadas
    const categoriesToAdd = categories.filter(
      category => !categoryTitles.includes(category),
    );

    const newCategories = categoriesRepository.create(
      categoriesToAdd.map(title => ({
        title,
      })),
    );

    await categoriesRepository.save(newCategories);

    const finalCategories = [...newCategories, ...existentCategories];

    const createdTransactions = transactionsRepository.create(
      transactionsTmp.map(transaction => ({
        ...transaction,
        category: finalCategories.find(
          category => transaction.category === category.title,
        ),
      })),
    );

    await transactionsRepository.save(createdTransactions);

    fs.promises.unlink(filePath);

    return createdTransactions;
  }
}

export default ImportTransactionsService;
