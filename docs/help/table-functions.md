# Table function reference

Every function a table formula can use, 449 in all.
This page is generated from the function registry. Do not edit it by hand.

Square brackets mark an optional argument. "..." means the argument can repeat.
See [Tables and charts](tables-and-charts.md) for how formulas work.
See [Table formatting](table-formatting.md) for number formats.

## Math and trigonometry

| Function | Call | What it does |
| --- | --- | --- |
| `ABS` | `ABS(number)` | Gives the size of a number, without its sign. |
| `ACOS` | `ACOS(number)` | Gives the angle, in radians, whose cosine is the number. |
| `ACOSH` | `ACOSH(number)` | Gives the inverse hyperbolic cosine of a number that is at least 1. |
| `ACOT` | `ACOT(number)` | Gives the angle, in radians from 0 to pi, whose cotangent is the number. |
| `ACOTH` | `ACOTH(number)` | Gives the inverse hyperbolic cotangent of a number beyond -1 and 1. |
| `ADD` | `ADD(a, b)` | Adds two numbers. |
| `AGGREGATE` | `AGGREGATE(function, options, ref, ...)` | Calculates a sum, count, average, or other measure over cells. You choose which rows and errors to ignore. |
| `ARABIC` | `ARABIC(text)` | Turns a Roman numeral into a number. |
| `ASIN` | `ASIN(number)` | Gives the angle, in radians, whose sine is the number. |
| `ASINH` | `ASINH(number)` | Gives the inverse hyperbolic sine of a number. |
| `ATAN` | `ATAN(number)` | Gives the angle, in radians, whose tangent is the number. |
| `ATAN2` | `ATAN2(x, y)` | Gives the angle, in radians, of the point at x and y, measured from the x axis. |
| `ATANH` | `ATANH(number)` | Gives the inverse hyperbolic tangent of a number between -1 and 1. |
| `BASE` | `BASE(number, radix, [minLength])` | Writes a whole number in another base, such as binary or hexadecimal. |
| `CEILING` | `CEILING(number, [step])` | Rounds a number up to a multiple of the step. |
| `CEILING.MATH` | `CEILING.MATH(number, [step], [mode])` | Rounds a number up to a multiple of the step, with a choice for negative numbers. |
| `CEILING.PRECISE` | `CEILING.PRECISE(number, [step])` | Rounds a number up to a multiple of the step, whatever the sign of either. |
| `COMBIN` | `COMBIN(number, chosen)` | Counts the ways to choose items from a group, when order does not matter. |
| `COMBINA` | `COMBINA(number, chosen)` | Counts the ways to choose items from a group when an item may be chosen more than once. |
| `COS` | `COS(number)` | Gives the cosine of an angle in radians. |
| `COSH` | `COSH(number)` | Gives the hyperbolic cosine of a number. |
| `COT` | `COT(number)` | Gives the cotangent of an angle in radians. |
| `COTH` | `COTH(number)` | Gives the hyperbolic cotangent of a number. |
| `CSC` | `CSC(number)` | Gives the cosecant of an angle in radians. |
| `CSCH` | `CSCH(number)` | Gives the hyperbolic cosecant of a number. |
| `DECIMAL` | `DECIMAL(text, radix)` | Reads text written in another base and gives its value. |
| `DEGREES` | `DEGREES(number)` | Turns an angle in radians into degrees. |
| `DIVIDE` | `DIVIDE(a, b)` | Divides one number by another. |
| `EVEN` | `EVEN(number)` | Rounds a number away from zero to the next even whole number. |
| `EXP` | `EXP(number)` | Gives e raised to a power. |
| `FACT` | `FACT(number)` | Gives the factorial of a number: the product of the whole numbers from 1 up to it. |
| `FACTDOUBLE` | `FACTDOUBLE(number)` | Gives the double factorial: the product of every second whole number down from the number. |
| `FLOOR` | `FLOOR(number, [step])` | Rounds a number down to a multiple of the step. |
| `FLOOR.MATH` | `FLOOR.MATH(number, [step], [mode])` | Rounds a number down to a multiple of the step, with a choice for negative numbers. |
| `FLOOR.PRECISE` | `FLOOR.PRECISE(number, [step])` | Rounds a number down to a multiple of the step, whatever the sign of either. |
| `GCD` | `GCD(number, ...)` | Gives the largest whole number that divides every number given. |
| `INT` | `INT(number)` | Rounds a number down to the nearest whole number. |
| `ISO.CEILING` | `ISO.CEILING(number, [step])` | Rounds a number up to a multiple of the step, whatever the sign of either. |
| `LCM` | `LCM(number, ...)` | Gives the smallest whole number that every number given divides. |
| `LN` | `LN(number)` | Gives the natural logarithm of a number. |
| `LOG` | `LOG(number, [base])` | Gives the logarithm of a number to the base you choose. |
| `LOG10` | `LOG10(number)` | Gives the base 10 logarithm of a number. |
| `MINUS` | `MINUS(a, b)` | Subtracts the second number from the first. |
| `MOD` | `MOD(number, divisor)` | Gives the remainder after division. The result has the sign of the divisor. |
| `MROUND` | `MROUND(number, multiple)` | Rounds a number to the nearest multiple. |
| `MULTINOMIAL` | `MULTINOMIAL(number, ...)` | Counts the ways to split a group into parts of the sizes given. |
| `MULTIPLY` | `MULTIPLY(a, b)` | Multiplies two numbers. |
| `ODD` | `ODD(number)` | Rounds a number away from zero to the next odd whole number. |
| `PERCENTOF` | `PERCENTOF(part, whole)` | Gives what share of the total the first cells make up. |
| `PI` | `PI()` | Gives pi, 3.14159265358979. |
| `POWER` | `POWER(number, power)` | Raises a number to a power. |
| `PRODUCT` | `PRODUCT(value, ...)` | Multiplies the numbers together. |
| `QUOTIENT` | `QUOTIENT(dividend, divisor)` | Gives the whole part of a division, dropping the remainder. |
| `RADIANS` | `RADIANS(number)` | Turns an angle in degrees into radians. |
| `RAND` | `RAND()` | Gives a random number from 0 up to, but not including, 1. It changes on every calculation. |
| `RANDBETWEEN` | `RANDBETWEEN(bottom, top)` | Gives a random whole number between two limits. It changes on every calculation. |
| `ROMAN` | `ROMAN(number, [form])` | Writes a number from 0 to 3999 as a Roman numeral. |
| `ROUND` | `ROUND(number, [digits])` | Rounds a number to a set number of decimal places, halves away from zero. |
| `ROUNDDOWN` | `ROUNDDOWN(number, [digits])` | Rounds a number toward zero to a set number of decimal places. |
| `ROUNDUP` | `ROUNDUP(number, [digits])` | Rounds a number away from zero to a set number of decimal places. |
| `SEC` | `SEC(number)` | Gives the secant of an angle in radians. |
| `SECH` | `SECH(number)` | Gives the hyperbolic secant of a number. |
| `SERIESSUM` | `SERIESSUM(x, n, m, coefficients)` | Adds the terms of a power series: each coefficient times x raised to a growing power. |
| `SIGN` | `SIGN(number)` | Gives 1 for a positive number, -1 for a negative one, and 0 for zero. |
| `SIN` | `SIN(number)` | Gives the sine of an angle in radians. |
| `SINH` | `SINH(number)` | Gives the hyperbolic sine of a number. |
| `SQRT` | `SQRT(number)` | Gives the square root of a number. |
| `SQRTPI` | `SQRTPI(number)` | Gives the square root of a number times pi. |
| `SUBTOTAL` | `SUBTOTAL(function, ref, ...)` | Calculates a sum, count, average, or other measure over a range, skipping filtered rows. Numbers from 101 up also skip hidden rows. |
| `SUM` | `SUM(value, ...)` | Adds the numbers together. |
| `SUMIF` | `SUMIF(range, criterion, [sumRange])` | Adds the cells that meet a test. |
| `SUMIFS` | `SUMIFS(sumRange, criteriaRange, criterion, ...)` | Adds the cells whose matching cells meet every test. |
| `SUMPRODUCT` | `SUMPRODUCT(array, ...)` | Multiplies matching items of the blocks and adds the products. |
| `SUMSQ` | `SUMSQ(value, ...)` | Adds the squares of the numbers. |
| `SUMX2MY2` | `SUMX2MY2(arrayX, arrayY)` | Adds the difference of the squares of matching items in two blocks. |
| `SUMX2PY2` | `SUMX2PY2(arrayX, arrayY)` | Adds the sum of the squares of matching items in two blocks. |
| `SUMXMY2` | `SUMXMY2(arrayX, arrayY)` | Adds the squares of the differences of matching items in two blocks. |
| `TAN` | `TAN(number)` | Gives the tangent of an angle in radians. |
| `TANH` | `TANH(number)` | Gives the hyperbolic tangent of a number. |
| `TRUNC` | `TRUNC(number, [digits])` | Cuts a number to a set number of decimal places, toward zero. |

## Arrays

| Function | Call | What it does |
| --- | --- | --- |
| `ARRAYFORMULA` | `ARRAYFORMULA(array_formula)` | Gives a formula as it is. |
| `CHOOSECOLS` | `CHOOSECOLS(array, col_num, ...)` | Takes the chosen columns of an array. |
| `CHOOSEROWS` | `CHOOSEROWS(array, row_num, ...)` | Takes the chosen rows of an array. |
| `DROP` | `DROP(array, rows, [columns])` | Removes rows or columns from the start or the end of an array. |
| `EXPAND` | `EXPAND(array, rows, [columns], [pad_with])` | Makes an array larger, filling the new cells. |
| `FILTER` | `FILTER(array, include, [if_empty])` | Keeps the rows (or columns) of an array that pass a test. |
| `FLATTEN` | `FLATTEN(range, ...)` | Puts every value of the ranges in one column, row by row. |
| `HSTACK` | `HSTACK(array, ...)` | Joins arrays side by side. |
| `MDETERM` | `MDETERM(array)` | Gives the determinant of a square matrix. |
| `MINVERSE` | `MINVERSE(array)` | Gives the inverse of a square matrix. |
| `MMULT` | `MMULT(array1, array2)` | Multiplies a matrix by another. |
| `MUNIT` | `MUNIT(dimension)` | Gives the identity matrix of a size. |
| `RANDARRAY` | `RANDARRAY([rows], [columns], [min], [max], [integer])` | Gives an array of random numbers. |
| `SEQUENCE` | `SEQUENCE(rows, [columns], [start], [step])` | Gives an array of numbers that grow by a step. |
| `SORT` | `SORT(array, [sort_index], [sort_order], [by_col])` | Sorts the rows (or columns) of an array. |
| `SORTBY` | `SORTBY(array, by_array, [sort_order], ...)` | Sorts an array by the values of other rows or columns. |
| `SORTN` | `SORTN(range, [n], [display_ties_mode], [sort_column, is_ascending], ...)` | Sorts a range and keeps its first rows. |
| `TAKE` | `TAKE(array, rows, [columns])` | Keeps rows or columns from the start or the end of an array. |
| `TOCOL` | `TOCOL(array, [ignore], [scan_by_column])` | Puts every value of an array in one column. |
| `TOROW` | `TOROW(array, [ignore], [scan_by_column])` | Puts every value of an array in one row. |
| `TRANSPOSE` | `TRANSPOSE(array)` | Swaps the rows and columns of an array. |
| `TRIMRANGE` | `TRIMRANGE(range, [trim_rows], [trim_cols])` | Removes the empty rows and columns at the edges of a range. |
| `UNIQUE` | `UNIQUE(array, [by_col], [exactly_once])` | Keeps each distinct row (or column) of an array once. |
| `VSTACK` | `VSTACK(array, ...)` | Joins arrays one above the other. |
| `WRAPCOLS` | `WRAPCOLS(vector, wrap_count, [pad_with])` | Cuts a row or column of values into columns of a set length. |
| `WRAPROWS` | `WRAPROWS(vector, wrap_count, [pad_with])` | Cuts a row or column of values into rows of a set length. |

## Statistics

| Function | Call | What it does |
| --- | --- | --- |
| `AVEDEV` | `AVEDEV(value, ...)` | Gives the average distance of the numbers from their mean. |
| `AVERAGE` | `AVERAGE(value, ...)` | Gives the mean of the numbers. |
| `AVERAGEA` | `AVERAGEA(value, ...)` | Gives the mean of the values, with text as 0 and TRUE as 1. |
| `AVERAGEIF` | `AVERAGEIF(range, criterion, [averageRange])` | Gives the mean of the cells whose matching cells meet a test. |
| `AVERAGEIFS` | `AVERAGEIFS(averageRange, criteriaRange, criterion, ...)` | Gives the mean of the cells whose matching cells meet every test. |
| `BETA.DIST` | `BETA.DIST(x, alpha, beta, cumulative, [lower], [upper])` | Gives the beta distribution at x, between optional bounds. |
| `BETA.INV` | `BETA.INV(probability, alpha, beta, [lower], [upper])` | Gives the x at which the cumulative beta distribution reaches a probability. |
| `BINOM.DIST` | `BINOM.DIST(successes, trials, probability, cumulative)` | Gives the chance of a number of successes in a set of trials. |
| `BINOM.DIST.RANGE` | `BINOM.DIST.RANGE(trials, probability, successes, [successes2])` | Gives the chance that the successes fall within a range. |
| `BINOM.INV` | `BINOM.INV(trials, probability, alpha)` | Gives the fewest successes whose cumulative chance reaches alpha. |
| `CHISQ.DIST` | `CHISQ.DIST(x, degrees, cumulative)` | Gives the chi-squared distribution at x. |
| `CHISQ.DIST.RT` | `CHISQ.DIST.RT(x, degrees)` | Gives the chance of a chi-squared value above x. |
| `CHISQ.INV` | `CHISQ.INV(probability, degrees)` | Gives the x below which a chi-squared value falls with a probability. |
| `CHISQ.INV.RT` | `CHISQ.INV.RT(probability, degrees)` | Gives the x above which a chi-squared value falls with a probability. |
| `CHISQ.TEST` | `CHISQ.TEST(actual, expected)` | Tests whether observed counts fit expected ones, and gives the chance. |
| `CONFIDENCE.NORM` | `CONFIDENCE.NORM(alpha, sd, size)` | Gives half the width of a confidence interval for a mean, by the normal law. |
| `CONFIDENCE.T` | `CONFIDENCE.T(alpha, sd, size)` | Gives half the width of a confidence interval for a mean, by Student's t law. |
| `CORREL` | `CORREL(array1, array2)` | Gives the correlation of two blocks of numbers, from -1 to 1. |
| `COUNT` | `COUNT(value, ...)` | Counts the numbers. |
| `COUNTA` | `COUNTA(value, ...)` | Counts the cells that are not empty. |
| `COUNTBLANK` | `COUNTBLANK(value, ...)` | Counts the empty cells. |
| `COUNTIF` | `COUNTIF(range, criterion)` | Counts the cells that meet a test. |
| `COUNTIFS` | `COUNTIFS(criteriaRange, criterion, ...)` | Counts the rows whose cells meet every test. |
| `COUNTUNIQUE` | `COUNTUNIQUE(value, ...)` | Counts the different values, leaving out empty cells. |
| `COVARIANCE.P` | `COVARIANCE.P(array1, array2)` | Gives the population covariance of two blocks of numbers. |
| `COVARIANCE.S` | `COVARIANCE.S(array1, array2)` | Gives the sample covariance of two blocks of numbers. |
| `DEVSQ` | `DEVSQ(value, ...)` | Adds the squared distances of the numbers from their mean. |
| `EXPON.DIST` | `EXPON.DIST(x, lambda, cumulative)` | Gives the exponential distribution at x. |
| `F.DIST` | `F.DIST(x, degrees1, degrees2, cumulative)` | Gives the F distribution at x. |
| `F.DIST.RT` | `F.DIST.RT(x, degrees1, degrees2)` | Gives the chance of an F value above x. |
| `F.INV` | `F.INV(probability, degrees1, degrees2)` | Gives the x below which an F value falls with a probability. |
| `F.INV.RT` | `F.INV.RT(probability, degrees1, degrees2)` | Gives the x above which an F value falls with a probability. |
| `F.TEST` | `F.TEST(array1, array2)` | Tests whether two samples have the same variance, and gives the two-tailed chance. |
| `FISHER` | `FISHER(x)` | Gives the Fisher transform of a correlation. |
| `FISHERINV` | `FISHERINV(y)` | Turns a Fisher transform back into a correlation. |
| `FORECAST` | `FORECAST(x, knownY, knownX)` | Predicts y at x from a straight line through known points. |
| `FORECAST.ETS` | `FORECAST.ETS(target, values, timeline, [seasonality], [completion], [aggregation])` | Forecasts a value by exponential smoothing with trend and season. |
| `FORECAST.ETS.CONFINT` | `FORECAST.ETS.CONFINT(target, values, timeline, [confidence], [seasonality], [completion], [aggregation])` | Gives half the width of the confidence interval of an exponential smoothing forecast. |
| `FORECAST.ETS.SEASONALITY` | `FORECAST.ETS.SEASONALITY(values, timeline, [completion], [aggregation])` | Gives the season length that exponential smoothing finds in a series. |
| `FORECAST.ETS.STAT` | `FORECAST.ETS.STAT(values, timeline, statistic, [seasonality], [completion], [aggregation])` | Gives a measure of an exponential smoothing fit, such as its error. |
| `FORECAST.LINEAR` | `FORECAST.LINEAR(x, knownY, knownX)` | Predicts y at x from a straight line through known points. |
| `FREQUENCY` | `FREQUENCY(data, bins)` | Counts how many values fall in each bin, as a column. |
| `GAMMA` | `GAMMA(x)` | Gives the gamma function of a number. |
| `GAMMA.DIST` | `GAMMA.DIST(x, alpha, beta, cumulative)` | Gives the gamma distribution at x. |
| `GAMMA.INV` | `GAMMA.INV(probability, alpha, beta)` | Gives the x at which the cumulative gamma distribution reaches a probability. |
| `GAMMALN` | `GAMMALN(x)` | Gives the natural logarithm of the gamma function. |
| `GAMMALN.PRECISE` | `GAMMALN.PRECISE(x)` | Gives the natural logarithm of the gamma function. |
| `GAUSS` | `GAUSS(z)` | Gives the chance that a standard normal value falls between the mean and z. |
| `GEOMEAN` | `GEOMEAN(value, ...)` | Gives the geometric mean of positive numbers. |
| `GROWTH` | `GROWTH(knownY, [knownX], [newX], [const])` | Predicts values on an exponential curve fitted to known points. |
| `HARMEAN` | `HARMEAN(value, ...)` | Gives the harmonic mean of positive numbers. |
| `HYPGEOM.DIST` | `HYPGEOM.DIST(sampleS, sample, populationS, population, cumulative)` | Gives the chance of a number of successes when drawing without putting items back. |
| `INTERCEPT` | `INTERCEPT(knownY, knownX)` | Gives where the least-squares line crosses the y axis. |
| `KURT` | `KURT(value, ...)` | Gives how heavy the tails of the numbers are, compared with the normal law. |
| `LARGE` | `LARGE(array, k)` | Gives the k-th largest number. |
| `LINEST` | `LINEST(knownY, [knownX], [const], [stats])` | Fits a straight line or plane by least squares and gives its coefficients. |
| `LOGEST` | `LOGEST(knownY, [knownX], [const], [stats])` | Fits an exponential curve and gives its factors. |
| `LOGNORM.DIST` | `LOGNORM.DIST(x, mean, sd, cumulative)` | Gives the lognormal distribution at x. |
| `LOGNORM.INV` | `LOGNORM.INV(probability, mean, sd)` | Gives the x at which the cumulative lognormal distribution reaches a probability. |
| `MAX` | `MAX(value, ...)` | Gives the largest number. |
| `MAXA` | `MAXA(value, ...)` | Gives the largest value, with text as 0 and TRUE as 1. |
| `MAXIFS` | `MAXIFS(maxRange, criteriaRange, criterion, ...)` | Gives the largest of the cells whose rows meet every test. |
| `MEDIAN` | `MEDIAN(value, ...)` | Gives the middle number. |
| `MIN` | `MIN(value, ...)` | Gives the smallest number. |
| `MINA` | `MINA(value, ...)` | Gives the smallest value, with text as 0 and TRUE as 1. |
| `MINIFS` | `MINIFS(minRange, criteriaRange, criterion, ...)` | Gives the smallest of the cells whose rows meet every test. |
| `MODE.MULT` | `MODE.MULT(value, ...)` | Gives every most common number, as a column. |
| `MODE.SNGL` | `MODE.SNGL(value, ...)` | Gives the most common number. |
| `NEGBINOM.DIST` | `NEGBINOM.DIST(failures, successes, probability, cumulative)` | Gives the chance of a number of failures before a number of successes. |
| `NORM.DIST` | `NORM.DIST(x, mean, sd, cumulative)` | Gives the normal distribution at x. |
| `NORM.INV` | `NORM.INV(probability, mean, sd)` | Gives the x at which the cumulative normal distribution reaches a probability. |
| `NORM.S.DIST` | `NORM.S.DIST(z, cumulative)` | Gives the standard normal distribution at z. |
| `NORM.S.INV` | `NORM.S.INV(probability)` | Gives the z at which the cumulative standard normal distribution reaches a probability. |
| `PEARSON` | `PEARSON(array1, array2)` | Gives the Pearson correlation of two blocks of numbers. |
| `PERCENTILE.EXC` | `PERCENTILE.EXC(array, k)` | Gives the value at a fraction of the way through the numbers, with 0 and 1 left out. |
| `PERCENTILE.INC` | `PERCENTILE.INC(array, k)` | Gives the value at a fraction of the way through the numbers, from 0 to 1. |
| `PERCENTRANK.EXC` | `PERCENTRANK.EXC(array, x, [significance])` | Gives the share of the numbers below a value, with 0 and 1 left out. |
| `PERCENTRANK.INC` | `PERCENTRANK.INC(array, x, [significance])` | Gives the share of the numbers below a value, from 0 to 1. |
| `PERMUT` | `PERMUT(number, chosen)` | Counts the ordered ways to choose items without repeats. |
| `PERMUTATIONA` | `PERMUTATIONA(number, chosen)` | Counts the ordered ways to choose items with repeats. |
| `PHI` | `PHI(x)` | Gives the standard normal density at x. |
| `POISSON.DIST` | `POISSON.DIST(x, mean, cumulative)` | Gives the chance of a number of events by the Poisson law. |
| `PROB` | `PROB(xRange, probRange, lower, [upper])` | Gives the chance that a value falls between two limits. |
| `QUARTILE.EXC` | `QUARTILE.EXC(array, quart)` | Gives a quartile of the numbers, with 0 and 1 left out. |
| `QUARTILE.INC` | `QUARTILE.INC(array, quart)` | Gives a quartile of the numbers, from the smallest to the largest. |
| `RANK.AVG` | `RANK.AVG(number, ref, [order])` | Gives the place of a number in a list; ties share the average place. |
| `RANK.EQ` | `RANK.EQ(number, ref, [order])` | Gives the place of a number in a list; ties share the top place. |
| `RSQ` | `RSQ(knownY, knownX)` | Gives the square of the correlation of known y and known x. |
| `SKEW` | `SKEW(value, ...)` | Gives how lopsided a sample is around its mean. |
| `SKEW.P` | `SKEW.P(value, ...)` | Gives how lopsided a population is around its mean. |
| `SLOPE` | `SLOPE(knownY, knownX)` | Gives the slope of the least-squares line. |
| `SMALL` | `SMALL(array, k)` | Gives the k-th smallest number. |
| `STANDARDIZE` | `STANDARDIZE(x, mean, sd)` | Gives how many standard deviations x is from the mean. |
| `STDEV.P` | `STDEV.P(value, ...)` | Gives the standard deviation of a whole population. |
| `STDEV.S` | `STDEV.S(value, ...)` | Gives the standard deviation of a sample. |
| `STDEVA` | `STDEVA(value, ...)` | Gives the sample standard deviation, with text as 0 and TRUE as 1. |
| `STDEVPA` | `STDEVPA(value, ...)` | Gives the population standard deviation, with text as 0 and TRUE as 1. |
| `STEYX` | `STEYX(knownY, knownX)` | Gives the standard error of the y values predicted by the least-squares line. |
| `T.DIST` | `T.DIST(x, degrees, cumulative)` | Gives Student's t distribution at x. |
| `T.DIST.2T` | `T.DIST.2T(x, degrees)` | Gives the chance of a t value farther from 0 than x, in both tails. |
| `T.DIST.RT` | `T.DIST.RT(x, degrees)` | Gives the chance of a t value above x. |
| `T.INV` | `T.INV(probability, degrees)` | Gives the t value below which a value falls with a probability. |
| `T.INV.2T` | `T.INV.2T(probability, degrees)` | Gives the t value beyond which a value falls with a probability, in both tails. |
| `T.TEST` | `T.TEST(array1, array2, tails, type)` | Gives the chance from Student's t test that two samples share a mean. |
| `TREND` | `TREND(knownY, [knownX], [newX], [const])` | Predicts values on a straight line fitted to known points. |
| `TRIMMEAN` | `TRIMMEAN(array, percent)` | Gives the mean after leaving out a share of the smallest and largest numbers. |
| `VAR.P` | `VAR.P(value, ...)` | Gives the variance of a whole population. |
| `VAR.S` | `VAR.S(value, ...)` | Gives the variance of a sample. |
| `VARA` | `VARA(value, ...)` | Gives the sample variance, with text as 0 and TRUE as 1. |
| `VARPA` | `VARPA(value, ...)` | Gives the population variance, with text as 0 and TRUE as 1. |
| `WEIBULL.DIST` | `WEIBULL.DIST(x, alpha, beta, cumulative)` | Gives the Weibull distribution at x. |
| `Z.TEST` | `Z.TEST(array, x, [sigma])` | Gives the one-tailed chance of a sample mean at least this far above x. |

## Statistics, older names

| Function | Call | What it does |
| --- | --- | --- |
| `BETADIST` | `BETADIST(x, alpha, beta, [lower], [upper])` | Gives the cumulative beta distribution. An older name for BETA.DIST. |
| `BETAINV` | `BETAINV(probability, alpha, beta, [lower], [upper])` | Gives the inverse of the cumulative beta distribution. An older name for BETA.INV. |
| `BINOMDIST` | `BINOMDIST(successes, trials, probability, cumulative)` | Gives a binomial chance. An older name for BINOM.DIST. |
| `CHIDIST` | `CHIDIST(x, degrees)` | Gives the chance of a chi-squared value above x. An older name for CHISQ.DIST.RT. |
| `CHIINV` | `CHIINV(probability, degrees)` | Gives the x above which a chi-squared value falls. An older name for CHISQ.INV.RT. |
| `CHITEST` | `CHITEST(actual, expected)` | Tests observed counts against expected ones. An older name for CHISQ.TEST. |
| `CONFIDENCE` | `CONFIDENCE(alpha, sd, size)` | Gives half a normal confidence interval. An older name for CONFIDENCE.NORM. |
| `COVAR` | `COVAR(array1, array2)` | Gives the population covariance. An older name for COVARIANCE.P. |
| `CRITBINOM` | `CRITBINOM(trials, probability, alpha)` | Gives the fewest successes that reach alpha. An older name for BINOM.INV. |
| `EXPONDIST` | `EXPONDIST(x, lambda, cumulative)` | Gives the exponential distribution. An older name for EXPON.DIST. |
| `FDIST` | `FDIST(x, degrees1, degrees2)` | Gives the chance of an F value above x. An older name for F.DIST.RT. |
| `FINV` | `FINV(probability, degrees1, degrees2)` | Gives the x above which an F value falls. An older name for F.INV.RT. |
| `FTEST` | `FTEST(array1, array2)` | Tests whether two variances match. An older name for F.TEST. |
| `GAMMADIST` | `GAMMADIST(x, alpha, beta, cumulative)` | Gives the gamma distribution. An older name for GAMMA.DIST. |
| `GAMMAINV` | `GAMMAINV(probability, alpha, beta)` | Gives the inverse of the cumulative gamma distribution. An older name for GAMMA.INV. |
| `HYPGEOMDIST` | `HYPGEOMDIST(sampleS, sample, populationS, population)` | Gives a hypergeometric chance. An older name for HYPGEOM.DIST. |
| `LOGINV` | `LOGINV(probability, mean, sd)` | Gives the inverse of the cumulative lognormal distribution. An older name for LOGNORM.INV. |
| `LOGNORMDIST` | `LOGNORMDIST(x, mean, sd)` | Gives the cumulative lognormal distribution. An older name for LOGNORM.DIST. |
| `MODE` | `MODE(value, ...)` | Gives the most common number. An older name for MODE.SNGL. |
| `NEGBINOMDIST` | `NEGBINOMDIST(failures, successes, probability)` | Gives a negative binomial chance. An older name for NEGBINOM.DIST. |
| `NORMDIST` | `NORMDIST(x, mean, sd, cumulative)` | Gives the normal distribution. An older name for NORM.DIST. |
| `NORMINV` | `NORMINV(probability, mean, sd)` | Gives the inverse of the cumulative normal distribution. An older name for NORM.INV. |
| `NORMSDIST` | `NORMSDIST(z)` | Gives the cumulative standard normal distribution. An older name for NORM.S.DIST. |
| `NORMSINV` | `NORMSINV(probability)` | Gives the inverse of the standard normal distribution. An older name for NORM.S.INV. |
| `PERCENTILE` | `PERCENTILE(array, k)` | Gives a percentile from 0 to 1. An older name for PERCENTILE.INC. |
| `PERCENTRANK` | `PERCENTRANK(array, x, [significance])` | Gives the share of numbers below a value. An older name for PERCENTRANK.INC. |
| `POISSON` | `POISSON(x, mean, cumulative)` | Gives a Poisson chance. An older name for POISSON.DIST. |
| `QUARTILE` | `QUARTILE(array, quart)` | Gives a quartile. An older name for QUARTILE.INC. |
| `RANK` | `RANK(number, ref, [order])` | Gives the place of a number in a list. An older name for RANK.EQ. |
| `STDEV` | `STDEV(value, ...)` | Gives the sample standard deviation. An older name for STDEV.S. |
| `STDEVP` | `STDEVP(value, ...)` | Gives the population standard deviation. An older name for STDEV.P. |
| `TDIST` | `TDIST(x, degrees, tails)` | Gives one or both tails of Student's t law beyond x, for x at least 0. |
| `TINV` | `TINV(probability, degrees)` | Gives the two-tailed inverse of t. An older name for T.INV.2T. |
| `TTEST` | `TTEST(array1, array2, tails, type)` | Gives the chance from Student's t test. An older name for T.TEST. |
| `VAR` | `VAR(value, ...)` | Gives the sample variance. An older name for VAR.S. |
| `VARP` | `VARP(value, ...)` | Gives the population variance. An older name for VAR.P. |
| `WEIBULL` | `WEIBULL(x, alpha, beta, cumulative)` | Gives the Weibull distribution. An older name for WEIBULL.DIST. |
| `ZTEST` | `ZTEST(array, x, [sigma])` | Gives the one-tailed chance of a z test. An older name for Z.TEST. |

## Finance

| Function | Call | What it does |
| --- | --- | --- |
| `ACCRINT` | `ACCRINT(issue, first_interest, settlement, rate, par, frequency, [basis], [calc_method])` | The interest a bond with regular coupons has earned but not yet paid. |
| `ACCRINTM` | `ACCRINTM(issue, settlement, rate, par, [basis])` | The interest earned by a security that pays all its interest at maturity. |
| `AMORDEGRC` | `AMORDEGRC(cost, date_purchased, first_period, salvage, period, rate, [basis])` | Depreciation for a period by the French declining method, with a coefficient set by the life. |
| `AMORLINC` | `AMORLINC(cost, date_purchased, first_period, salvage, period, rate, [basis])` | Depreciation for a period by the French straight-line method. |
| `COUPDAYBS` | `COUPDAYBS(settlement, maturity, frequency, [basis])` | Days from the start of the coupon period to settlement. |
| `COUPDAYS` | `COUPDAYS(settlement, maturity, frequency, [basis])` | Days in the coupon period that holds settlement. |
| `COUPDAYSNC` | `COUPDAYSNC(settlement, maturity, frequency, [basis])` | Days from settlement to the next coupon date. |
| `COUPNCD` | `COUPNCD(settlement, maturity, frequency, [basis])` | The next coupon date after settlement. |
| `COUPNUM` | `COUPNUM(settlement, maturity, frequency, [basis])` | How many coupons are paid from settlement to maturity. |
| `COUPPCD` | `COUPPCD(settlement, maturity, frequency, [basis])` | The coupon date on or before settlement. |
| `CUMIPMT` | `CUMIPMT(rate, nper, pv, start_period, end_period, type)` | The interest paid on a loan from one period to another. |
| `CUMPRINC` | `CUMPRINC(rate, nper, pv, start_period, end_period, type)` | The principal paid on a loan from one period to another. |
| `DB` | `DB(cost, salvage, life, period, [month])` | Depreciation for a period by the fixed declining balance method. |
| `DDB` | `DDB(cost, salvage, life, period, [factor])` | Depreciation for a period by the double declining balance method, or another factor. |
| `DISC` | `DISC(settlement, maturity, pr, redemption, [basis])` | The discount rate of a security. |
| `DOLLARDE` | `DOLLARDE(fractional_dollar, fraction)` | Turns a price written as a fraction, such as 1.02 for 1 and 2/16, into a decimal number. |
| `DOLLARFR` | `DOLLARFR(decimal_dollar, fraction)` | Turns a decimal price into one written as a fraction, such as 1.125 into 1.02 for 1 and 2/16. |
| `DURATION` | `DURATION(settlement, maturity, coupon, yld, frequency, [basis])` | The Macaulay duration of a bond in years: the average time to its payments, weighted by their value. |
| `EFFECT` | `EFFECT(nominal_rate, npery)` | The yearly effective rate of a nominal rate compounded several times a year. |
| `FV` | `FV(rate, nper, pmt, [pv], [type])` | What an investment is worth after regular payments at a fixed rate. |
| `FVSCHEDULE` | `FVSCHEDULE(principal, schedule)` | What an amount grows to under a series of rates, one per period. |
| `INTRATE` | `INTRATE(settlement, maturity, investment, redemption, [basis])` | The interest rate of a fully invested security. |
| `IPMT` | `IPMT(rate, per, nper, pv, [fv], [type])` | The interest part of one payment on a loan or investment. |
| `IRR` | `IRR(values, [guess])` | The internal rate of return of cash flows one period apart. |
| `ISPMT` | `ISPMT(rate, per, nper, pv)` | The interest paid in one period of a loan repaid in equal parts of principal. |
| `MDURATION` | `MDURATION(settlement, maturity, coupon, yld, frequency, [basis])` | The modified duration of a bond: the Macaulay duration divided by one plus the yield per period. |
| `MIRR` | `MIRR(values, finance_rate, reinvest_rate)` | The rate of return when payments are financed at one rate and receipts reinvested at another. |
| `NOMINAL` | `NOMINAL(effect_rate, npery)` | The nominal yearly rate that gives an effective rate. |
| `NPER` | `NPER(rate, pmt, pv, [fv], [type])` | How many periods regular payments take at a fixed rate. |
| `NPV` | `NPV(rate, value1, ...)` | The net present value of cash flows one period apart, the first one period from now. |
| `ODDFPRICE` | `ODDFPRICE(settlement, maturity, issue, first_coupon, rate, yld, redemption, frequency, [basis])` | The price of a bond whose first period is shorter or longer than the others. |
| `ODDFYIELD` | `ODDFYIELD(settlement, maturity, issue, first_coupon, rate, pr, redemption, frequency, [basis])` | The yield of a bond whose first period is shorter or longer than the others. |
| `ODDLPRICE` | `ODDLPRICE(settlement, maturity, last_interest, rate, yld, redemption, frequency, [basis])` | The price of a bond whose last period is shorter or longer than the others. |
| `ODDLYIELD` | `ODDLYIELD(settlement, maturity, last_interest, rate, pr, redemption, frequency, [basis])` | The yield of a bond whose last period is shorter or longer than the others. |
| `PDURATION` | `PDURATION(rate, pv, fv)` | How many periods an investment takes to reach a value at a fixed rate. |
| `PMT` | `PMT(rate, nper, pv, [fv], [type])` | The regular payment of a loan or investment at a fixed rate. |
| `PPMT` | `PPMT(rate, per, nper, pv, [fv], [type])` | The principal part of one payment on a loan or investment. |
| `PRICE` | `PRICE(settlement, maturity, rate, yld, redemption, frequency, [basis])` | The price per 100 of face value of a bond that pays regular coupons. |
| `PRICEDISC` | `PRICEDISC(settlement, maturity, discount, redemption, [basis])` | The price per 100 of face value of a discounted security. |
| `PRICEMAT` | `PRICEMAT(settlement, maturity, issue, rate, yld, [basis])` | The price per 100 of face value of a security that pays its interest at maturity. |
| `PV` | `PV(rate, nper, pmt, [fv], [type])` | What a series of future payments is worth now. |
| `RATE` | `RATE(nper, pmt, pv, [fv], [type], [guess])` | The interest rate per period of a loan or investment. |
| `RECEIVED` | `RECEIVED(settlement, maturity, investment, discount, [basis])` | What a fully invested security pays at maturity. |
| `RRI` | `RRI(nper, pv, fv)` | The rate per period that grows a present value to a future value. |
| `SLN` | `SLN(cost, salvage, life)` | Straight-line depreciation for one period. |
| `SYD` | `SYD(cost, salvage, life, per)` | Sum-of-years' digits depreciation for a period. |
| `TBILLEQ` | `TBILLEQ(settlement, maturity, discount)` | The bond-equivalent yield of a Treasury bill. |
| `TBILLPRICE` | `TBILLPRICE(settlement, maturity, discount)` | The price per 100 of face value of a Treasury bill. |
| `TBILLYIELD` | `TBILLYIELD(settlement, maturity, pr)` | The yield of a Treasury bill. |
| `VDB` | `VDB(cost, salvage, life, start_period, end_period, [factor], [no_switch])` | Declining balance depreciation over any span of periods, switching to straight line when that gives more. |
| `XIRR` | `XIRR(values, dates, [guess])` | The internal rate of return of cash flows on given dates, a year being 365 days. |
| `XNPV` | `XNPV(rate, values, dates)` | The net present value of cash flows on given dates, a year being 365 days. |
| `YIELD` | `YIELD(settlement, maturity, rate, pr, redemption, frequency, [basis])` | The yield of a bond that pays regular coupons. |
| `YIELDDISC` | `YIELDDISC(settlement, maturity, pr, redemption, [basis])` | The yearly yield of a discounted security. |
| `YIELDMAT` | `YIELDMAT(settlement, maturity, issue, rate, pr, [basis])` | The yearly yield of a security that pays its interest at maturity. |

## Text

| Function | Call | What it does |
| --- | --- | --- |
| `ARRAYTOTEXT` | `ARRAYTOTEXT(array, [format])` | Writes an array as text. |
| `ASC` | `ASC(text)` | Changes full-width characters to half-width. Returns the text unchanged where no region needs it. |
| `BAHTTEXT` | `BAHTTEXT(number)` | Writes a number as Thai words for baht and satang. |
| `CHAR` | `CHAR(number)` | Returns the character for a code from 1 to 255. |
| `CLEAN` | `CLEAN(text)` | Removes the characters that do not print, those with codes 0 to 31. |
| `CODE` | `CODE(text)` | Returns the code of the first character of text. |
| `CONCAT` | `CONCAT(text, ...)` | Joins text from values and ranges into one piece of text. |
| `CONCATENATE` | `CONCATENATE(text, ...)` | Joins text from values into one piece of text. |
| `DBCS` | `DBCS(text)` | Changes half-width characters to full-width. Returns the text unchanged where no region needs it. |
| `DOLLAR` | `DOLLAR(number, [decimals])` | Formats a number as dollars, with negative amounts in brackets. |
| `ENCODEURL` | `ENCODEURL(text)` | Encodes text for use in a web address. |
| `EXACT` | `EXACT(text1, text2)` | Tells whether 2 pieces of text are the same, with case. |
| `FIND` | `FIND(find_text, within_text, [start_num])` | Finds text inside other text and returns where it starts. Case matters and wildcards do not work. |
| `FINDB` | `FINDB(find_text, within_text, [start_num])` | Like FIND, counting in bytes. Every character is one byte. |
| `FIXED` | `FIXED(number, [decimals], [no_commas])` | Formats a number with a fixed number of decimals. |
| `JOIN` | `JOIN(delimiter, value, ...)` | Joins values with a delimiter between them. |
| `LEFT` | `LEFT(text, [num_chars])` | Returns the first characters of text. |
| `LEFTB` | `LEFTB(text, [num_chars])` | Returns the first bytes of text. Every character is one byte. |
| `LEN` | `LEN(text)` | Counts the characters in text. |
| `LENB` | `LENB(text)` | Counts the bytes in text. Every character is one byte. |
| `LOWER` | `LOWER(text)` | Changes text to lowercase. |
| `MID` | `MID(text, start_num, num_chars)` | Returns characters from the middle of text. |
| `MIDB` | `MIDB(text, start_num, num_chars)` | Returns bytes from the middle of text. Every character is one byte. |
| `NUMBERVALUE` | `NUMBERVALUE(text, [decimal_separator], [group_separator])` | Reads text as a number with separators you choose. |
| `PHONETIC` | `PHONETIC(reference)` | Returns the text of a value. No phonetic readings are kept. |
| `PROPER` | `PROPER(text)` | Capitalizes the first letter of every word and lowercases the rest. |
| `REPLACE` | `REPLACE(old_text, start_num, num_chars, new_text)` | Replaces part of text by position. |
| `REPLACEB` | `REPLACEB(old_text, start_num, num_chars, new_text)` | Replaces part of text by byte position. Every character is one byte. |
| `REPT` | `REPT(text, number_times)` | Repeats text a number of times. |
| `RIGHT` | `RIGHT(text, [num_chars])` | Returns the last characters of text. |
| `RIGHTB` | `RIGHTB(text, [num_chars])` | Returns the last bytes of text. Every character is one byte. |
| `SEARCH` | `SEARCH(find_text, within_text, [start_num])` | Finds text inside other text. Case does not matter. Use ? for one character and * for a run. |
| `SEARCHB` | `SEARCHB(find_text, within_text, [start_num])` | Like SEARCH, counting in bytes. Every character is one byte. |
| `SPLIT` | `SPLIT(text, delimiter, [split_by_each], [remove_empty])` | Splits text into a row of pieces. |
| `SUBSTITUTE` | `SUBSTITUTE(text, old_text, new_text, [instance_num])` | Replaces matching text. Case matters. |
| `T` | `T(value)` | Returns the value if it is text, and empty text if not. |
| `TEXT` | `TEXT(value, format_text)` | Formats a value with a number format code and returns text. |
| `TEXTAFTER` | `TEXTAFTER(text, delimiter, [instance_num], [match_mode], [match_end], [if_not_found])` | Returns the text after a delimiter. |
| `TEXTBEFORE` | `TEXTBEFORE(text, delimiter, [instance_num], [match_mode], [match_end], [if_not_found])` | Returns the text before a delimiter. |
| `TEXTJOIN` | `TEXTJOIN(delimiter, ignore_empty, text, ...)` | Joins text with a delimiter between the pieces. |
| `TEXTSPLIT` | `TEXTSPLIT(text, [col_delimiter], [row_delimiter], [ignore_empty], [match_mode], [pad_with])` | Splits text into columns and rows at delimiters. |
| `TRIM` | `TRIM(text)` | Removes spaces from the ends of text and reduces runs of spaces inside it to one. |
| `UNICHAR` | `UNICHAR(number)` | Returns the character for a Unicode number. |
| `UNICODE` | `UNICODE(text)` | Returns the Unicode number of the first character of text. |
| `UPPER` | `UPPER(text)` | Changes text to uppercase. |
| `VALUE` | `VALUE(text)` | Reads text as a number. |
| `VALUETOTEXT` | `VALUETOTEXT(value, [format])` | Writes a value as text. |

## Regular expressions

| Function | Call | What it does |
| --- | --- | --- |
| `REGEXEXTRACT` | `REGEXEXTRACT(text, pattern, [return_mode], [case_sensitivity])` | Pulls matching text out of text. Mode 2 returns the capturing groups. |
| `REGEXMATCH` | `REGEXMATCH(text, pattern)` | Tells whether text matches a regular expression. A pattern can have at most 1,000 characters. |
| `REGEXREPLACE` | `REGEXREPLACE(text, pattern, replacement, [occurrence], [case_sensitivity])` | Replaces text that matches a pattern of at most 1,000 characters. Use $1 for a group and $$ for a dollar sign. |
| `REGEXTEST` | `REGEXTEST(text, pattern, [case_sensitivity])` | Tells whether text matches a regular expression. A pattern can have at most 1,000 characters. |

## Date and time

| Function | Call | What it does |
| --- | --- | --- |
| `DATE` | `DATE(year, month, day)` | Builds a date from a year, a month, and a day. Months and days that run over roll into the next period. |
| `DATEDIF` | `DATEDIF(start, end, unit)` | The difference between two dates in whole years, months, or days. |
| `DATEVALUE` | `DATEVALUE(text)` | Reads date text and gives its serial number. |
| `DAY` | `DAY(date)` | The day of the month of a date, 1 to 31. |
| `DAYS` | `DAYS(end, start)` | The number of days from one date to another. |
| `DAYS360` | `DAYS360(start, end, [european])` | Days between two dates on a year of 12 months of 30 days. |
| `EDATE` | `EDATE(start, months)` | The date a number of months before or after another, on the same day when the month has it. |
| `EOMONTH` | `EOMONTH(start, months)` | The last day of the month, a number of months before or after a date. |
| `EPOCHTODATE` | `EPOCHTODATE(timestamp, [unit])` | Turns a Unix timestamp into a date and time in UTC. |
| `HOUR` | `HOUR(time)` | The hour of a time, 0 to 23. |
| `ISOWEEKNUM` | `ISOWEEKNUM(date)` | The ISO week of the year, where week 1 holds the first Thursday. |
| `MINUTE` | `MINUTE(time)` | The minute of a time, 0 to 59. |
| `MONTH` | `MONTH(date)` | The month of a date, 1 to 12. |
| `NETWORKDAYS` | `NETWORKDAYS(start, end, [holidays])` | Working days between two dates, counting both ends, with Saturday and Sunday off. |
| `NETWORKDAYS.INTL` | `NETWORKDAYS.INTL(start, end, [weekend], [holidays])` | Working days between two dates, counting both ends, with weekend days you choose. |
| `NOW` | `NOW()` | The date and the time right now. It updates whenever the sheet recalculates. |
| `SECOND` | `SECOND(time)` | The second of a time, 0 to 59. |
| `TIME` | `TIME(hour, minute, second)` | Builds a time of day, as a fraction of a day. More than 24 hours wraps around. |
| `TIMEVALUE` | `TIMEVALUE(text)` | Reads time text and gives it as a fraction of a day. |
| `TODAY` | `TODAY()` | Today as a date. It updates whenever the sheet recalculates. |
| `WEEKDAY` | `WEEKDAY(date, [type])` | The day of the week of a date as a number. |
| `WEEKNUM` | `WEEKNUM(date, [type])` | The week of the year of a date. Week 1 is the week that holds January 1. |
| `WORKDAY` | `WORKDAY(start, days, [holidays])` | The date a number of working days from a start date, with Saturday and Sunday off. |
| `WORKDAY.INTL` | `WORKDAY.INTL(start, days, [weekend], [holidays])` | The date a number of working days from a start date, with weekend days you choose. |
| `YEAR` | `YEAR(date)` | The year of a date. |
| `YEARFRAC` | `YEARFRAC(start, end, [basis])` | The part of a year between two dates. |

## Lookup and reference

| Function | Call | What it does |
| --- | --- | --- |
| `ADDRESS` | `ADDRESS(row_num, column_num, [abs_num], [a1], [sheet_text])` | Writes a cell reference as text from its row and column numbers. |
| `AREAS` | `AREAS(reference)` | Gives how many areas a reference has, such as 2 for (A1:B2,D4). |
| `CHOOSE` | `CHOOSE(index_num, value1, [value2], ...)` | Gives one value from a list, picked by its number. |
| `COLUMN` | `COLUMN([reference])` | Gives the column number of a reference, or of this cell when left out. |
| `COLUMNS` | `COLUMNS(array)` | Gives how many columns a reference or an array has. |
| `FORMULATEXT` | `FORMULATEXT(reference)` | Gives the formula in a cell as text. A cell without a formula gives #N/A. |
| `HLOOKUP` | `HLOOKUP(lookup_value, table_array, row_index_num, [range_lookup])` | Finds a value in the first row of a table and gives the value in the same column of another row. |
| `HYPERLINK` | `HYPERLINK(link_location, [friendly_name])` | Shows a link. The cell opens it only when it is clicked. |
| `INDEX` | `INDEX(array, [row_num], [column_num], [area_num])` | Gives the cell at a row and column of a block, or a whole row or column when one of them is 0. |
| `INDIRECT` | `INDIRECT(ref_text, [a1])` | Gives the cells that a piece of text names, such as "B2". It recalculates often. |
| `LOOKUP` | `LOOKUP(lookup_value, lookup_vector, [result_vector])` | Finds the nearest smaller value in sorted data and gives the matching value from another row or column. |
| `MATCH` | `MATCH(lookup_value, lookup_array, [match_type])` | Gives the position of a value in a row or column. |
| `OFFSET` | `OFFSET(reference, rows, cols, [height], [width])` | Gives a block that starts a number of rows and columns away from a reference. It recalculates often. |
| `ROW` | `ROW([reference])` | Gives the row number of a reference, or of this cell when left out. |
| `ROWS` | `ROWS(array)` | Gives how many rows a reference or an array has. |
| `VLOOKUP` | `VLOOKUP(lookup_value, table_array, col_index_num, [range_lookup])` | Finds a value in the first column of a table and gives the value in the same row of another column. |
| `XLOOKUP` | `XLOOKUP(lookup_value, lookup_array, return_array, [if_not_found], [match_mode], [search_mode])` | Finds a value in one row or column and gives what is in the same place in another. |
| `XMATCH` | `XMATCH(lookup_value, lookup_array, [match_mode], [search_mode])` | Gives the position of a value in a row or column, with the same choices as XLOOKUP. |

## Logic

| Function | Call | What it does |
| --- | --- | --- |
| `AND` | `AND(logical, ...)` | Gives TRUE when every argument is true. |
| `BYCOL` | `BYCOL(array, lambda)` | Calls a function on each column of an array and gives one value per column. |
| `BYROW` | `BYROW(array, lambda)` | Calls a function on each row of an array and gives one value per row. |
| `FALSE` | `FALSE()` | Gives the logical value FALSE. |
| `IF` | `IF(test, then, [otherwise])` | Gives one result when a test is true and another when it is false. |
| `IFERROR` | `IFERROR(value, on_error)` | Gives a fallback when a value is an error. |
| `IFNA` | `IFNA(value, on_na)` | Gives a fallback when a value is #N/A. |
| `IFS` | `IFS(test, result, ...)` | Gives the result of the first test that is true. #N/A when none is. |
| `LAMBDA` | `LAMBDA(parameter, ..., calculation)` | Makes a function of your own. Call it right away or give it a name. |
| `LET` | `LET(name, value, ..., calculation)` | Gives names to values, then calculates with them. |
| `MAKEARRAY` | `MAKEARRAY(rows, columns, lambda)` | Builds an array by calling a function with each cell’s row and column number. |
| `MAP` | `MAP(array, ..., lambda)` | Calls a function on each value of one or more arrays. |
| `NOT` | `NOT(logical)` | Turns TRUE into FALSE and FALSE into TRUE. |
| `OR` | `OR(logical, ...)` | Gives TRUE when any argument is true. |
| `REDUCE` | `REDUCE([initial_value], array, lambda)` | Combines the values of an array into one result, a step at a time. |
| `SCAN` | `SCAN([initial_value], array, lambda)` | Combines the values of an array a step at a time and gives every step. |
| `SWITCH` | `SWITCH(value, match, result, ..., [default])` | Compares a value with a list of matches and gives the result of the first one that is equal. |
| `TRUE` | `TRUE()` | Gives the logical value TRUE. |
| `XOR` | `XOR(logical, ...)` | Gives TRUE when an odd number of arguments are true. |

## Information

| Function | Call | What it does |
| --- | --- | --- |
| `CELL` | `CELL(info_type, [reference])` | Gives facts about a cell, such as its address, row, column, type, or format. |
| `ERROR.TYPE` | `ERROR.TYPE(error)` | Gives a number for the kind of error, such as 2 for divide by zero and 7 for not available. |
| `INFO` | `INFO(type_text)` | Gives a fact about this page that is safe to share, such as the calculation mode. |
| `ISBLANK` | `ISBLANK(value)` | Gives TRUE for an empty cell. |
| `ISDATE` | `ISDATE(value)` | Gives TRUE for a date, such as a cell in a date column, or for text that reads as a date. |
| `ISEMAIL` | `ISEMAIL(value)` | Gives TRUE for text shaped like an email address. |
| `ISERR` | `ISERR(value)` | Gives TRUE for any error except #N/A. |
| `ISERROR` | `ISERROR(value)` | Gives TRUE for any error. |
| `ISEVEN` | `ISEVEN(number)` | Gives TRUE when a number is even. A fraction is cut off first. |
| `ISFORMULA` | `ISFORMULA(reference)` | Gives TRUE when a cell holds a formula. |
| `ISLOGICAL` | `ISLOGICAL(value)` | Gives TRUE for TRUE or FALSE. |
| `ISNA` | `ISNA(value)` | Gives TRUE for #N/A. |
| `ISNONTEXT` | `ISNONTEXT(value)` | Gives TRUE for anything that is not text, an empty cell included. |
| `ISNUMBER` | `ISNUMBER(value)` | Gives TRUE for a number. Text that looks like a number is not one. |
| `ISODD` | `ISODD(number)` | Gives TRUE when a number is odd. A fraction is cut off first. |
| `ISOMITTED` | `ISOMITTED(argument)` | In a function made with LAMBDA, gives TRUE when an optional input was left out. |
| `ISREF` | `ISREF(value)` | Gives TRUE when the value is a reference to cells. |
| `ISTEXT` | `ISTEXT(value)` | Gives TRUE for text. |
| `ISURL` | `ISURL(value)` | Gives TRUE for text shaped like a web address. |
| `N` | `N(value)` | Turns a value into a number. TRUE is 1, text is 0. |
| `NA` | `NA()` | Gives the error #N/A, which means a value is not available. |
| `SHEET` | `SHEET([value])` | Gives the position of a table on the page, counting from 1. |
| `SHEETS` | `SHEETS([reference])` | Gives how many tables the page has. |
| `TYPE` | `TYPE(value)` | Gives a code for the kind of value: 1 number, 2 text, 4 logical, 16 error, 64 array. |
